import type { RuntimeConfig } from "../config/env.js";
import type { SingleNetwork } from "../config/networks.js";
import { fetchAllSubgraphClusterIds } from "../clients/subgraph.js";
import { summarizeStatuses, type CheckStatus } from "../status.js";
import { parseClusterId } from "../domain/cluster-id.js";
import {
  type ClusterAccountingDebug,
  type ClusterCheckKind,
  type ClusterCheckReason,
  type ClusterIdentityCheckResult,
  type VerifyClusterDependencies as SingleVerifyClusterDependencies,
  type VerifyClusterResult,
  renderVerifyClusterSummary,
  verifyClusterIdentity,
} from "./verify-cluster.js";

type VerifyClusterFunctionResult = Omit<VerifyClusterResult, "checks" | "accountingDebug"> & {
  checks: Array<Partial<ClusterIdentityCheckResult> & Pick<ClusterIdentityCheckResult, "name" | "status" | "detail" | "subgraphValue">>;
  accountingDebug?: ClusterAccountingDebug;
};

export interface VerifyClusterBatchResult extends VerifyClusterResult {
  errorDetail?: string;
}

export interface VerifyClustersResult {
  network: VerifyClusterResult["network"];
  status: CheckStatus;
  subgraphSource: "primary" | "fallback";
  totalClusters: number;
  totalChecks: number;
  passedChecks: number;
  warnedChecks: number;
  inconclusiveChecks: number;
  failedChecks: number;
  clusterResults: VerifyClusterBatchResult[];
}

export interface VerifyClustersDependencies {
  fetchFn?: typeof fetch;
  fetchClusterIds?: typeof fetchAllSubgraphClusterIds;
  verifyCluster?: (
    config: RuntimeConfig,
    clusterId: string,
    dependencies?: SingleVerifyClusterDependencies,
  ) => Promise<VerifyClusterFunctionResult>;
}

const CLUSTER_VERIFICATION_CONCURRENCY_LIMIT = 10;

export interface VerifyClustersRunResult {
  selectedNetwork: RuntimeConfig["selectedNetwork"];
  status: CheckStatus;
  totalClusters: number;
  totalChecks: number;
  passedChecks: number;
  warnedChecks: number;
  inconclusiveChecks: number;
  failedChecks: number;
  networkResults: VerifyClustersResult[];
}

function summarizeStatus(statuses: CheckStatus[]): CheckStatus {
  return summarizeStatuses(statuses);
}

function kindForCheck(name: ClusterIdentityCheckResult["name"]): ClusterCheckKind {
  if (name === "currentBalance" || name === "burnRate" || name === "liquidationCollateral" || name === "liquidatable") {
    return "derived";
  }

  if (name === "subgraphLag") {
    return "operational";
  }

  return "input";
}

function reasonForCheck(check: Partial<ClusterIdentityCheckResult> & Pick<ClusterIdentityCheckResult, "status">): ClusterCheckReason {
  if (check.reason) {
    return check.reason;
  }

  if (check.blockedBy?.length) {
    return "blocked";
  }

  if (check.status === "pass") {
    return "matched";
  }

  if (check.classification === "mismatch" || check.status === "fail") {
    return "mismatch";
  }

  if (check.classification === "lag-affected" || check.status === "warn") {
    return "lagging";
  }

  return "unavailable";
}

function normalizeClusterResult(result: VerifyClusterFunctionResult): VerifyClusterResult {
  const checks = result.checks.map((check) => ({
    kind: check.kind ?? kindForCheck(check.name),
    reason: reasonForCheck(check),
    classification: check.classification ?? (check.status === "pass" ? "verified" : check.status === "warn" ? "lag-affected" : check.status === "fail" ? "mismatch" : "inconclusive"),
    ...check,
  })) satisfies ClusterIdentityCheckResult[];

  return {
    ...result,
    checks,
    accountingDebug: result.accountingDebug ?? {},
  };
}

function createMalformedClusterIdResult(
  network: SingleNetwork,
  clusterId: string,
  subgraphSource: "primary" | "fallback",
  error: Error,
): VerifyClusterBatchResult {
  return {
    network,
    clusterId,
    subgraphSource,
    freshness: {
      indexedBlockNumber: 0,
      chainHeadBlockNumber: 0,
      lagBlocks: 0,
      status: "fresh",
    },
    status: "fail",
    checks: [
      {
        name: "clusterState",
        kind: "input",
        status: "fail",
        reason: "invalid",
        classification: "mismatch",
        detail: `Discovered cluster id was malformed: ${error.message}`,
        subgraphValue: clusterId,
      },
    ],
    accountingDebug: { failureStage: "clusterState" },
  };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]!, currentIndex);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

async function verifyAllClustersForNetwork(
  config: RuntimeConfig,
  network: SingleNetwork,
  dependencies: VerifyClustersDependencies,
): Promise<VerifyClustersResult> {
  const fetchFn = dependencies.fetchFn ?? fetch;
  const fetchClusterIds = dependencies.fetchClusterIds ?? fetchAllSubgraphClusterIds;
  const verifyCluster = dependencies.verifyCluster ?? verifyClusterIdentity;
  const networkConfig = config.networks[network];
  const clusterListing = await fetchClusterIds(
    networkConfig.subgraphPrimaryUrl,
    networkConfig.subgraphFallbackUrl,
    fetchFn,
  );
  const singleNetworkConfig = {
    ...config,
    selectedNetwork: network,
    activeNetworks: [network],
  } satisfies RuntimeConfig;
  const clusterResults = await mapWithConcurrency(
    clusterListing.clusterIds,
    CLUSTER_VERIFICATION_CONCURRENCY_LIMIT,
    async (clusterId) => {
      try {
        parseClusterId(clusterId);
      } catch (error) {
        return createMalformedClusterIdResult(
          network,
          clusterId,
          clusterListing.source,
          error instanceof Error ? error : new Error(String(error)),
        );
      }

      try {
        return normalizeClusterResult(await verifyCluster(singleNetworkConfig, clusterId, { fetchFn }));
      } catch (error) {
        return {
          network,
          clusterId,
          subgraphSource: clusterListing.source,
          freshness: {
            indexedBlockNumber: 0,
            chainHeadBlockNumber: 0,
            lagBlocks: 0,
            status: "fresh",
          },
          status: "inconclusive",
          checks: [
            {
              name: "clusterState",
              kind: "input",
              status: "inconclusive",
              reason: "unavailable",
              classification: "inconclusive",
              detail: error instanceof Error ? error.message : String(error),
              subgraphValue: clusterId,
            },
          ],
          accountingDebug: { failureStage: "clusterState" },
          errorDetail: error instanceof Error ? error.message : String(error),
        } satisfies VerifyClusterBatchResult;
      }
    },
  );
  const totalChecks = clusterResults.reduce((sum, result) => sum + result.checks.length, 0);
  const passedChecks = clusterResults.reduce(
    (sum, result) => sum + result.checks.filter((check) => check.status === "pass").length,
    0,
  );
  const warnedChecks = clusterResults.reduce(
    (sum, result) => sum + result.checks.filter((check) => check.status === "warn").length,
    0,
  );
  const inconclusiveChecks = clusterResults.reduce(
    (sum, result) => sum + result.checks.filter((check) => check.status === "inconclusive").length,
    0,
  );
  const failedChecks = clusterResults.reduce(
    (sum, result) => sum + result.checks.filter((check) => check.status === "fail").length,
    0,
  );

  return {
    network,
    status: summarizeStatus(clusterResults.map((result) => result.status)),
    subgraphSource: clusterListing.source,
    totalClusters: clusterResults.length,
    totalChecks,
    passedChecks,
    warnedChecks,
    inconclusiveChecks,
    failedChecks,
    clusterResults,
  };
}

export async function verifyAllClusters(
  config: RuntimeConfig,
  dependencies: VerifyClustersDependencies = {},
): Promise<VerifyClustersResult> {
  if (config.activeNetworks.length !== 1) {
    throw new Error("verify-clusters requires a single network target, not --network both.");
  }

  const network = config.activeNetworks[0]!;
  return verifyAllClustersForNetwork(config, network, dependencies);
}

export async function verifyClusters(
  config: RuntimeConfig,
  dependencies: VerifyClustersDependencies = {},
): Promise<VerifyClustersRunResult> {
  const networkResults = await Promise.all(
    config.activeNetworks.map((network) => verifyAllClustersForNetwork(config, network, dependencies)),
  );
  const totalClusters = networkResults.reduce((sum, result) => sum + result.totalClusters, 0);
  const totalChecks = networkResults.reduce((sum, result) => sum + result.totalChecks, 0);
  const passedChecks = networkResults.reduce((sum, result) => sum + result.passedChecks, 0);
  const warnedChecks = networkResults.reduce((sum, result) => sum + result.warnedChecks, 0);
  const inconclusiveChecks = networkResults.reduce((sum, result) => sum + result.inconclusiveChecks, 0);
  const failedChecks = networkResults.reduce((sum, result) => sum + result.failedChecks, 0);

  return {
    selectedNetwork: config.selectedNetwork,
    status: summarizeStatus(networkResults.map((result) => result.status)),
    totalClusters,
    totalChecks,
    passedChecks,
    warnedChecks,
    inconclusiveChecks,
    failedChecks,
    networkResults,
  };
}

export function renderVerifyClustersSummary(result: VerifyClustersRunResult): string {
  const lines = [
    `verify-clusters ${result.status.toUpperCase()}`,
    `network selection: ${result.selectedNetwork}`,
    `clusters: ${result.totalClusters}`,
    `checks: ${result.passedChecks} passed / ${result.warnedChecks} warned / ${result.inconclusiveChecks} inconclusive / ${result.failedChecks} failed / ${result.totalChecks} total`,
  ];

  for (const networkResult of result.networkResults) {
    lines.push(
      `- ${networkResult.network}: ${networkResult.passedChecks} passed / ${networkResult.warnedChecks} warned / ${networkResult.inconclusiveChecks} inconclusive / ${networkResult.failedChecks} failed / ${networkResult.totalChecks} total (source=${networkResult.subgraphSource})`,
    );

    for (const clusterResult of networkResult.clusterResults.filter((entry) => entry.status !== "pass")) {
      const nonPassingChecks = clusterResult.checks
        .filter((check) => check.status !== "pass")
        .map((check) => `${check.name}:${check.status}`);
      lines.push(`- ${networkResult.network}/${clusterResult.clusterId}: non-passing checks=${nonPassingChecks.join(", ")}`);
    }
  }

  return lines.join("\n");
}

export function renderVerifyClustersJson(result: VerifyClustersRunResult): string {
  return JSON.stringify(result, null, 2);
}

export { renderVerifyClusterSummary };
