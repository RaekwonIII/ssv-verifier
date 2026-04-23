import type { RuntimeConfig } from "../config/env.js";
import type { SingleNetwork } from "../config/networks.js";
import { fetchAllSubgraphClusterIds } from "../clients/subgraph.js";
import { summarizeStatuses, type CheckStatus } from "../status.js";
import { type VerifyClusterResult, renderVerifyClusterSummary, verifyClusterIdentity } from "./verify-cluster.js";

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
  clusterResults: VerifyClusterResult[];
}

export interface VerifyClustersDependencies {
  fetchFn?: typeof fetch;
  fetchClusterIds?: typeof fetchAllSubgraphClusterIds;
  verifyCluster?: typeof verifyClusterIdentity;
}

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
  const clusterResults = await Promise.all(
    clusterListing.clusterIds.map((clusterId) => verifyCluster(singleNetworkConfig, clusterId, { fetchFn })),
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

export { renderVerifyClusterSummary };
