import { describe, expect, it } from "vitest";

import { verifyAllClusters, renderVerifyClustersSummary } from "../src/commands/verify-clusters.js";
import { loadRuntimeConfig } from "../src/config/env.js";

const baseEnv = {
  MAINNET_RPC_URL: "https://mainnet.example",
  HOODI_RPC_URL: "https://hoodi.example",
  MAINNET_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000001",
  HOODI_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000002",
};

describe("verifyAllClusters", () => {
  it("aggregates single-network cluster verification results", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    const result = await verifyAllClusters(config, {
      fetchClusterIds: async () => ({
        clusterIds: ["cluster-a", "cluster-b"],
        source: "primary",
      }),
      verifyCluster: async (_runtimeConfig, clusterId) => ({
        network: "hoodi",
        clusterId,
        subgraphSource: "primary",
        status: clusterId === "cluster-a" ? "pass" : "fail",
        checks: clusterId === "cluster-a"
          ? [
              {
                name: "owner",
                status: "pass",
                detail: "matched",
                subgraphValue: "0x1",
                viewsValue: "0x1",
              },
            ]
          : [
              {
                name: "owner",
                status: "pass",
                detail: "matched",
                subgraphValue: "0x2",
                viewsValue: "0x2",
              },
              {
                name: "currentBalance",
                status: "fail",
                detail: "mismatch",
                subgraphValue: "30",
                viewsValue: "29",
              },
            ],
      }),
    });

    expect(result).toMatchObject({
      network: "hoodi",
      subgraphSource: "primary",
      status: "fail",
      totalClusters: 2,
      totalChecks: 3,
      passedChecks: 2,
      failedChecks: 1,
    });
    expect(renderVerifyClustersSummary(result)).toContain("verify-clusters FAIL");
    expect(renderVerifyClustersSummary(result)).toContain("cluster-b: failed checks=currentBalance");
  });
});
