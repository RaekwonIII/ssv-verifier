import type { RuntimeConfig } from "../config/env.js";
import type { SingleNetwork } from "../config/networks.js";
import { fetchAllSubgraphClusterIds } from "../clients/subgraph.js";
import { type CheckStatus, type VerifyClusterResult, renderVerifyClusterSummary, verifyClusterIdentity } from "./verify-cluster.js";

export interface VerifyClustersResult {
  network: VerifyClusterResult["network"];
  status: CheckStatus;
  subgraphSource: "primary" | "fallback";
  totalClusters: number;
  totalChecks: number;
  passedChecks: number;
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
  failedChecks: number;
  networkResults: VerifyClustersResult[];
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
  const failedChecks = totalChecks - passedChecks;

  return {
    network,
    status: failedChecks === 0 ? "pass" : "fail",
    subgraphSource: clusterListing.source,
    totalClusters: clusterResults.length,
    totalChecks,
    passedChecks,
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
  const failedChecks = totalChecks - passedChecks;

  return {
    selectedNetwork: config.selectedNetwork,
    status: failedChecks === 0 ? "pass" : "fail",
    totalClusters,
    totalChecks,
    passedChecks,
    failedChecks,
    networkResults,
  };
}

export function renderVerifyClustersSummary(result: VerifyClustersRunResult): string {
  const lines = [
    `verify-clusters ${result.status.toUpperCase()}`,
    `network selection: ${result.selectedNetwork}`,
    `clusters: ${result.totalClusters}`,
    `checks: ${result.passedChecks} passed / ${result.failedChecks} failed / ${result.totalChecks} total`,
  ];

  for (const networkResult of result.networkResults) {
    lines.push(
      `- ${networkResult.network}: ${networkResult.passedChecks} passed / ${networkResult.failedChecks} failed / ${networkResult.totalChecks} total (source=${networkResult.subgraphSource})`,
    );

    for (const clusterResult of networkResult.clusterResults.filter((entry) => entry.status === "fail")) {
      const failedChecks = clusterResult.checks.filter((check) => check.status === "fail").map((check) => check.name);
      lines.push(`- ${networkResult.network}/${clusterResult.clusterId}: failed checks=${failedChecks.join(", ")}`);
    }
  }

  return lines.join("\n");
}

export { renderVerifyClusterSummary };
