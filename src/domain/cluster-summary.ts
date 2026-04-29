import type { ClusterIdentityCheckResult, VerifyClusterResult } from "../commands/verify-cluster.js";

export const rootCauseSummaryKeys = [
  "clusterState",
  "assetType",
  "daoData",
  "operatorData",
  "effectiveBalance",
  "owner",
  "operatorIds",
  "validatorCount",
  "active",
] as const;

export const operationalSummaryKeys = ["subgraphLag"] as const;
export const discoverySummaryKeys = ["clusterListing"] as const;

export type RootCauseSummaryKey = typeof rootCauseSummaryKeys[number];
export type OperationalSummaryKey = typeof operationalSummaryKeys[number];
export type DiscoverySummaryKey = typeof discoverySummaryKeys[number];

export type RootCauseSummary = Record<RootCauseSummaryKey, number>;
export type OperationalSummary = Record<OperationalSummaryKey, number>;
export type DiscoverySummary = Record<DiscoverySummaryKey, number>;

export interface ClusterBatchSummary {
  rootCauses: RootCauseSummary;
  operational: OperationalSummary;
  discovery: DiscoverySummary;
}

export interface ClusterBatchSummaryInputs {
  clusterResults: ReadonlyArray<Pick<VerifyClusterResult, "checks">>;
  discoveryFailureCount?: number;
}

function zeroFilledRecord<const T extends readonly string[]>(keys: T): Record<T[number], number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T[number], number>;
}

export function createEmptyClusterBatchSummary(): ClusterBatchSummary {
  return {
    rootCauses: zeroFilledRecord(rootCauseSummaryKeys),
    operational: zeroFilledRecord(operationalSummaryKeys),
    discovery: zeroFilledRecord(discoverySummaryKeys),
  };
}

function rootCauseSummaryKeyFor(check: ClusterIdentityCheckResult): RootCauseSummaryKey | null {
  return (rootCauseSummaryKeys as readonly string[]).includes(check.name)
    ? check.name as RootCauseSummaryKey
    : null;
}

function isRealRootCause(check: ClusterIdentityCheckResult, summaryKey: RootCauseSummaryKey | null): summaryKey is RootCauseSummaryKey {
  return summaryKey !== null
    && check.kind === "input"
    && check.status !== "pass"
    && check.reason !== "blocked"
    && !check.blockedBy?.length;
}

export function summarizeClusterBatch(inputs: ClusterBatchSummaryInputs): ClusterBatchSummary {
  const summary = createEmptyClusterBatchSummary();

  for (const result of inputs.clusterResults) {
    for (const check of result.checks) {
      const rootCauseSummaryKey = rootCauseSummaryKeyFor(check);

      if (isRealRootCause(check, rootCauseSummaryKey)) {
        summary.rootCauses[rootCauseSummaryKey] += 1;
        continue;
      }

      if (check.name === "subgraphLag" && check.status === "warn") {
        summary.operational.subgraphLag += 1;
      }
    }
  }

  summary.discovery.clusterListing = inputs.discoveryFailureCount ?? 0;

  return summary;
}

export function combineClusterBatchSummaries(summaries: ReadonlyArray<ClusterBatchSummary>): ClusterBatchSummary {
  const combined = createEmptyClusterBatchSummary();

  for (const summary of summaries) {
    for (const key of rootCauseSummaryKeys) {
      combined.rootCauses[key] += summary.rootCauses[key];
    }

    for (const key of operationalSummaryKeys) {
      combined.operational[key] += summary.operational[key];
    }

    for (const key of discoverySummaryKeys) {
      combined.discovery[key] += summary.discovery[key];
    }
  }

  return combined;
}
