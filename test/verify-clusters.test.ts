import { describe, expect, it } from "vitest";

import { renderVerifyClustersJson, renderVerifyClustersSummary, verifyAllClusters, verifyClusters } from "../src/commands/verify-clusters.js";
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
        freshness: {
          indexedBlockNumber: 20,
          chainHeadBlockNumber: 20,
          lagBlocks: 0,
          status: "fresh",
        },
        status: clusterId === "cluster-a" ? "pass" : "fail",
        checks: clusterId === "cluster-a"
          ? [
              {
                name: "owner",
                status: "pass",
                classification: "verified",
                detail: "matched",
                subgraphValue: "0x1",
                viewsValue: "0x1",
              },
            ]
          : [
              {
                name: "owner",
                status: "pass",
                classification: "verified",
                detail: "matched",
                subgraphValue: "0x2",
                viewsValue: "0x2",
              },
              {
                name: "currentBalance",
                status: "fail",
                classification: "mismatch",
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
      warnedChecks: 0,
      inconclusiveChecks: 0,
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
        freshness: {
          indexedBlockNumber: clusterId === "hoodi-cluster" ? 18 : 20,
          chainHeadBlockNumber: 20,
          lagBlocks: clusterId === "hoodi-cluster" ? 2 : 0,
          status: clusterId === "hoodi-cluster" ? "lagging" : "fresh",
        },
        status: clusterId === "hoodi-cluster" ? "warn" : "fail",
        checks: clusterId === "hoodi-cluster"
          ? [
              {
                name: "owner",
                status: "warn",
                classification: "lag-affected",
                detail: "lagged",
                subgraphValue: "0x1",
                viewsValue: "0x1",
              },
            ]
          : [
              {
                name: "owner",
                status: "fail",
                classification: "mismatch",
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
      passedChecks: 0,
      warnedChecks: 1,
      inconclusiveChecks: 0,
      failedChecks: 1,
    });
    expect(renderVerifyClustersSummary(result)).toContain("network selection: both");
    expect(renderVerifyClustersSummary(result)).toContain("- hoodi: 0 passed / 1 warned / 0 inconclusive / 0 failed / 1 total");
    expect(renderVerifyClustersSummary(result)).toContain("- mainnet: 0 passed / 0 warned / 0 inconclusive / 1 failed / 1 total");
    expect(renderVerifyClustersSummary(result)).toContain("hoodi/hoodi-cluster: non-passing checks=owner:warn");
    expect(renderVerifyClustersSummary(result)).toContain("mainnet/mainnet-cluster: non-passing checks=owner:fail");
    expect(JSON.parse(renderVerifyClustersJson(result))).toMatchObject({
      selectedNetwork: "both",
      status: "fail",
      totalClusters: 2,
      networkResults: [
        {
          network: "hoodi",
          clusterResults: [
            {
              clusterId: "hoodi-cluster",
              status: "warn",
            },
          ],
        },
        {
          network: "mainnet",
          clusterResults: [
            {
              clusterId: "mainnet-cluster",
              status: "fail",
            },
          ],
        },
      ],
    });
  });

  it("treats inconclusive batch results as non-zero aggregate outcomes", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    const result = await verifyAllClusters(config, {
      fetchClusterIds: async () => ({
        clusterIds: ["cluster-a"],
        source: "primary",
      }),
      verifyCluster: async (_runtimeConfig, clusterId) => ({
        network: "hoodi",
        clusterId,
        subgraphSource: "primary",
        freshness: {
          indexedBlockNumber: 20,
          chainHeadBlockNumber: 20,
          lagBlocks: 0,
          status: "fresh",
        },
        status: "inconclusive",
        checks: [
          {
            name: "currentBalance",
            status: "inconclusive",
            classification: "inconclusive",
            detail: "missing DAO values",
            subgraphValue: "unknown",
          },
        ],
      }),
    });

    expect(result).toMatchObject({
      status: "inconclusive",
      totalChecks: 1,
      passedChecks: 0,
      warnedChecks: 0,
      inconclusiveChecks: 1,
      failedChecks: 0,
    });
    expect(renderVerifyClustersSummary({
      selectedNetwork: "hoodi",
      ...result,
      networkResults: [result],
    })).toContain("1 inconclusive");
  });
});
