import { describe, expect, it } from "vitest";

import {
  combineClusterBatchSummaries,
  createEmptyClusterBatchSummary,
  summarizeClusterBatch,
} from "../src/domain/cluster-summary.js";
import type { ClusterIdentityCheckResult } from "../src/commands/verify-cluster.js";

function check(overrides: Partial<ClusterIdentityCheckResult> & Pick<ClusterIdentityCheckResult, "name" | "kind" | "status" | "reason">): ClusterIdentityCheckResult {
  return {
    classification: overrides.status === "pass" ? "verified" : overrides.status === "warn" ? "lag-affected" : overrides.status === "fail" ? "mismatch" : "inconclusive",
    detail: `${overrides.name} ${overrides.status}`,
    subgraphValue: "value",
    ...overrides,
  };
}

describe("cluster batch summary", () => {
  it("creates canonical zero-filled summary buckets", () => {
    expect(createEmptyClusterBatchSummary()).toEqual({
      rootCauses: {
        clusterState: 0,
        assetType: 0,
        daoData: 0,
        operatorData: 0,
        effectiveBalance: 0,
      },
      operational: {
        subgraphLag: 0,
      },
      discovery: {
        clusterListing: 0,
      },
    });
  });

  it("counts only non-blocked input root causes, lag warnings, and listing discovery failures", () => {
    const summary = summarizeClusterBatch({
      discoveryFailureCount: 1,
      clusterResults: [
        {
          checks: [
            check({ name: "clusterState", kind: "input", status: "fail", reason: "invalid" }),
            check({ name: "assetType", kind: "input", status: "inconclusive", reason: "blocked", blockedBy: ["clusterState"], subgraphValue: "blocked" }),
            check({ name: "currentBalance", kind: "derived", status: "fail", reason: "mismatch" }),
            check({ name: "subgraphLag", kind: "operational", status: "warn", reason: "lagging" }),
          ],
        },
        {
          checks: [
            check({ name: "daoData", kind: "input", status: "fail", reason: "missing" }),
            check({ name: "operatorData", kind: "input", status: "inconclusive", reason: "unavailable" }),
            check({ name: "subgraphLag", kind: "operational", status: "pass", reason: "matched" }),
          ],
        },
      ],
    });

    expect(summary).toEqual({
      rootCauses: {
        clusterState: 1,
        assetType: 0,
        daoData: 1,
        operatorData: 1,
        effectiveBalance: 0,
      },
      operational: {
        subgraphLag: 1,
      },
      discovery: {
        clusterListing: 1,
      },
    });
  });

  it("combines per-network summaries without changing bucket order", () => {
    const combined = combineClusterBatchSummaries([
      summarizeClusterBatch({
        clusterResults: [
          { checks: [check({ name: "assetType", kind: "input", status: "fail", reason: "mismatch" })] },
        ],
      }),
      summarizeClusterBatch({
        discoveryFailureCount: 2,
        clusterResults: [
          { checks: [check({ name: "subgraphLag", kind: "operational", status: "warn", reason: "lagging" })] },
        ],
      }),
    ]);

    expect(Object.keys(combined.rootCauses)).toEqual([
      "clusterState",
      "assetType",
      "daoData",
      "operatorData",
      "effectiveBalance",
    ]);
    expect(combined.rootCauses.assetType).toBe(1);
    expect(combined.operational.subgraphLag).toBe(1);
    expect(combined.discovery.clusterListing).toBe(2);
  });
});
