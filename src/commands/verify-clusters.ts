import type { RuntimeConfig } from "../config/env.js";
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

export async function verifyAllClusters(
  config: RuntimeConfig,
  dependencies: VerifyClustersDependencies = {},
): Promise<VerifyClustersResult> {
  if (config.activeNetworks.length !== 1) {
    throw new Error("verify-clusters requires a single network target, not --network both.");
  }

  const fetchFn = dependencies.fetchFn ?? fetch;
  const fetchClusterIds = dependencies.fetchClusterIds ?? fetchAllSubgraphClusterIds;
  const verifyCluster = dependencies.verifyCluster ?? verifyClusterIdentity;
  const network = config.activeNetworks[0]!;
  const networkConfig = config.networks[network];
  const clusterListing = await fetchClusterIds(
    networkConfig.subgraphPrimaryUrl,
    networkConfig.subgraphFallbackUrl,
    fetchFn,
  );
  const clusterResults = await Promise.all(
    clusterListing.clusterIds.map((clusterId) => verifyCluster(config, clusterId, { fetchFn })),
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

export function renderVerifyClustersSummary(result: VerifyClustersResult): string {
  const lines = [
    `verify-clusters ${result.status.toUpperCase()}`,
    `network: ${result.network}`,
    `subgraph source: ${result.subgraphSource}`,
    `clusters: ${result.totalClusters}`,
    `checks: ${result.passedChecks} passed / ${result.failedChecks} failed / ${result.totalChecks} total`,
  ];

  for (const clusterResult of result.clusterResults.filter((entry) => entry.status === "fail")) {
    const failedChecks = clusterResult.checks.filter((check) => check.status === "fail").map((check) => check.name);
    lines.push(`- ${clusterResult.clusterId}: failed checks=${failedChecks.join(", ")}`);
  }

  return lines.join("\n");
}

export { renderVerifyClusterSummary };
