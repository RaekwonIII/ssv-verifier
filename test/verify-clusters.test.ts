import { describe, expect, it } from "vitest";

import { renderVerifyClustersSummary, verifyAllClusters, verifyClusters } from "../src/commands/verify-clusters.js";
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
  });

  it("aggregates results across both networks", async () => {
    const config = loadRuntimeConfig("both", baseEnv);
    const result = await verifyClusters(config, {
      fetchClusterIds: async (primaryUrl) => ({
        clusterIds: primaryUrl.includes("hoodi") ? ["hoodi-cluster"] : ["mainnet-cluster"],
        source: "primary",
      }),
      verifyCluster: async (runtimeConfig, clusterId) => ({
        network: runtimeConfig.activeNetworks[0]!,
        clusterId,
        subgraphSource: "primary",
        status: clusterId === "hoodi-cluster" ? "pass" : "fail",
        checks: clusterId === "hoodi-cluster"
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
                status: "fail",
                detail: "mismatch",
                subgraphValue: "0x2",
                viewsValue: "0x3",
              },
            ],
      }),
    });

    expect(result).toMatchObject({
      selectedNetwork: "both",
      status: "fail",
      totalClusters: 2,
      totalChecks: 2,
      passedChecks: 1,
      failedChecks: 1,
    });
    expect(renderVerifyClustersSummary(result)).toContain("network selection: both");
    expect(renderVerifyClustersSummary(result)).toContain("- hoodi: 1 passed / 0 failed / 1 total");
    expect(renderVerifyClustersSummary(result)).toContain("- mainnet: 0 passed / 1 failed / 1 total");
    expect(renderVerifyClustersSummary(result)).toContain("mainnet/mainnet-cluster: failed checks=owner");
  });
});
