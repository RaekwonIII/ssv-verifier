import { describe, expect, it } from "vitest";

import {
  toPublicVerifyClusterJson,
  type ClusterAccountingDebug,
  type ClusterIdentityCheckResult,
  type VerifyClusterResult,
} from "../src/commands/verify-cluster.js";

function check(overrides: Partial<ClusterIdentityCheckResult> & Pick<ClusterIdentityCheckResult, "name" | "kind" | "status" | "reason">): ClusterIdentityCheckResult {
  return {
    classification: overrides.status === "pass" ? "verified" : overrides.status === "warn" ? "lag-affected" : "mismatch",
    detail: `${overrides.name} ${overrides.status}`,
    subgraphValue: "value",
    ...overrides,
  };
}

function buildResult(overrides: Partial<VerifyClusterResult> = {}): VerifyClusterResult {
  return {
    network: "mainnet",
    clusterId: "0x000000000000000000000000000000000000aaaa-1-2-3-4",
    freshness: { indexedBlockNumber: 100, chainHeadBlockNumber: 100, lagBlocks: 0, status: "fresh" },
    status: "pass",
    checks: [
      check({ name: "clusterState", kind: "input", status: "pass", reason: "matched", subgraphValue: "ok" }),
    ],
    accountingDebug: {} satisfies ClusterAccountingDebug,
    ...overrides,
  };
}

describe("toPublicVerifyClusterJson", () => {
  it("emits a deterministic top-level field order", () => {
    const json = toPublicVerifyClusterJson(buildResult());
    expect(Object.keys(json)).toEqual([
      "network",
      "clusterId",
      "verificationBlock",
      "status",
      "checks",
      "accountingDebug",
    ]);
  });

  it("renames subgraphValue to localValue and omits unavailable optional fields", () => {
    const json = toPublicVerifyClusterJson(
      buildResult({
        checks: [
          check({ name: "currentBalance", kind: "derived", status: "pass", reason: "matched", subgraphValue: "30", viewsValue: "30" }),
          check({ name: "operatorData", kind: "input", status: "inconclusive", reason: "blocked", subgraphValue: "blocked", blockedBy: ["clusterState"] }),
        ],
      }),
    );

    const balanceCheck = (json.checks as Array<Record<string, unknown>>)[0]!;
    expect(balanceCheck).toMatchObject({
      name: "currentBalance",
      kind: "derived",
      status: "pass",
      reason: "matched",
      localValue: "30",
      viewsValue: "30",
    });
    expect(balanceCheck.subgraphValue).toBeUndefined();
    expect(balanceCheck.classification).toBeUndefined();

    const blockedCheck = (json.checks as Array<Record<string, unknown>>)[1]!;
    expect(blockedCheck.localValue).toBeUndefined();
    expect(blockedCheck.viewsValue).toBeUndefined();
    expect(blockedCheck.blockedBy).toEqual(["clusterState"]);
  });

  it("converts bigint accountingDebug values to strings and preserves failureStage", () => {
    const json = toPublicVerifyClusterJson(
      buildResult({
        status: "fail",
        accountingDebug: {
          failureStage: "currentBalance",
          selectedAsset: "ETH",
          intermediates: { burnRateRaw: 12345n },
        } as ClusterAccountingDebug,
      }),
    );

    expect(json.accountingDebug).toMatchObject({
      failureStage: "currentBalance",
      selectedAsset: "ETH",
      intermediates: { burnRateRaw: "12345" },
    });
  });
});
