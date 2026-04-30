import { describe, expect, it } from "vitest";

import { renderVerifyClustersJson, renderVerifyClustersSummary, verifyAllClusters, verifyClusters } from "../src/commands/verify-clusters.js";
import { loadRuntimeConfig } from "../src/config/env.js";

const baseEnv = {
  MAINNET_RPC_URL: "https://mainnet.example",
  HOODI_RPC_URL: "https://hoodi.example",
  MAINNET_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000001",
  HOODI_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000002",
};

function makeClusterId(index: number): string {
  const owner = `0x${index.toString(16).padStart(40, "0")}`;
  return `${owner}-1-2-3-4`;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

describe("verifyAllClusters", () => {
  it("aggregates single-network cluster verification results", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    const result = await verifyAllClusters(config, {
      fetchClusterIds: async () => ({
        clusterIds: [makeClusterId(1), makeClusterId(2)],
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
        status: clusterId === makeClusterId(1) ? "pass" : "fail",
        checks: clusterId === makeClusterId(1)
          ? [
              {
                name: "assetType",
                status: "pass",
                classification: "verified",
                detail: "matched",
                subgraphValue: "ETH",
                viewsValue: "ETH",
              },
            ]
          : [
              {
                name: "assetType",
                status: "pass",
                classification: "verified",
                detail: "matched",
                subgraphValue: "ETH",
                viewsValue: "ETH",
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
      summary: {
        rootCauses: expect.objectContaining({
          clusterState: 0,
          assetType: 0,
          daoData: 0,
          operatorData: 0,
          effectiveBalance: 0,
        }),
        operational: { subgraphLag: 0 },
        discovery: { clusterListing: 0 },
      },
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
        clusterIds: primaryUrl.includes("hoodi") ? [makeClusterId(11)] : [makeClusterId(12)],
        source: "primary",
      }),
      verifyCluster: async (runtimeConfig, clusterId) => ({
        network: runtimeConfig.activeNetworks[0]!,
        clusterId,
        subgraphSource: "primary",
        freshness: {
          indexedBlockNumber: clusterId === makeClusterId(11) ? 18 : 20,
          chainHeadBlockNumber: 20,
          lagBlocks: clusterId === makeClusterId(11) ? 2 : 0,
          status: clusterId === makeClusterId(11) ? "lagging" : "fresh",
        },
        status: clusterId === makeClusterId(11) ? "warn" : "fail",
        checks: clusterId === makeClusterId(11)
          ? [
              {
                name: "assetType",
                status: "warn",
                classification: "lag-affected",
                detail: "lagged",
                subgraphValue: "ETH",
                viewsValue: "ETH",
              },
            ]
          : [
              {
                name: "assetType",
                status: "fail",
                classification: "mismatch",
                detail: "mismatch",
                subgraphValue: "ETH",
                viewsValue: "SSV",
              },
            ],
      }),
    });

    expect(result).toMatchObject({
      selectedNetwork: "both",
      status: "fail",
      summary: expect.objectContaining({
        rootCauses: expect.objectContaining({ assetType: 2 }),
        operational: { subgraphLag: 0 },
        discovery: { clusterListing: 0 },
      }),
      totalClusters: 2,
      totalChecks: 2,
      passedChecks: 0,
      warnedChecks: 1,
      inconclusiveChecks: 0,
      failedChecks: 1,
    });
    expect(renderVerifyClustersSummary(result)).toContain("network selection: both");
    const text = renderVerifyClustersSummary(result);
    expect(text).toMatch(/^verify-clusters FAIL\nnetwork selection: both\nclusters: 2\nroot causes: assetType=2/);
    expect(text).toContain("- hoodi: WARN clusters=1 clusterListingSource=primary");
    expect(text).toContain("- mainnet: FAIL clusters=1 clusterListingSource=primary");
    expect(text).toContain(`  - ${makeClusterId(11)}: WARN checks=assetType:WARN(lagging)`);
    expect(text).toContain(`  - ${makeClusterId(12)}: FAIL checks=assetType:FAIL(mismatch)`);
    expect(text).not.toContain("operational:");
    expect(text).not.toContain("discovery:");
    const publicJson = JSON.parse(renderVerifyClustersJson(result));
    expect(Object.keys(publicJson)).toEqual(["selectedNetwork", "status", "summary", "networkResults"]);
    expect(publicJson).toMatchObject({
      selectedNetwork: "both",
      status: "fail",
      summary: expect.objectContaining({
        rootCauses: expect.objectContaining({ assetType: 2 }),
      }),
      networkResults: [
        {
          network: "hoodi",
          status: "warn",
          summary: expect.any(Object),
          clusterListingSource: "primary",
          clusterResults: [
            {
              network: "hoodi",
              clusterId: makeClusterId(11),
              status: "warn",
              checks: [
                expect.objectContaining({
                  name: "assetType",
                  kind: "input",
                  status: "warn",
                  reason: "lagging",
                  localValue: "ETH",
                  viewsValue: "ETH",
                }),
              ],
              accountingDebug: {},
            },
          ],
        },
        {
          network: "mainnet",
          status: "fail",
          summary: expect.any(Object),
          clusterListingSource: "primary",
          clusterResults: [
            {
              network: "mainnet",
              clusterId: makeClusterId(12),
              status: "fail",
              checks: [
                expect.objectContaining({
                  name: "assetType",
                  kind: "input",
                  status: "fail",
                  reason: "mismatch",
                  localValue: "ETH",
                  viewsValue: "SSV",
                }),
              ],
              accountingDebug: {},
            },
          ],
        },
      ],
    });
    expect(publicJson.totalClusters).toBeUndefined();
    expect(Object.keys(publicJson.networkResults[0])).toEqual([
      "network",
      "status",
      "summary",
      "clusterListingSource",
      "clusterResults",
    ]);
    expect(publicJson.networkResults[0].clusterResults[0].freshness).toBeUndefined();
    expect(publicJson.networkResults[0].clusterResults[0].checks[0].classification).toBeUndefined();
    expect(publicJson.networkResults[0].clusterResults[0].checks[0].subgraphValue).toBeUndefined();
  });

  it("continues through unverifiable clusters as inconclusive", async () => {
    const config = loadRuntimeConfig("both", baseEnv);
    const result = await verifyClusters(config, {
      fetchClusterIds: async (primaryUrl) => ({
        clusterIds: primaryUrl.includes("hoodi") ? [makeClusterId(11)] : [makeClusterId(12)],
        source: "fallback",
      }),
      verifyCluster: async (runtimeConfig, clusterId) => {
        if (clusterId === makeClusterId(12)) {
          throw new Error("subgraph timeout");
        }

        return {
          network: runtimeConfig.activeNetworks[0]!,
          clusterId,
          subgraphSource: "fallback",
          freshness: {
            indexedBlockNumber: 20,
            chainHeadBlockNumber: 20,
            lagBlocks: 0,
            status: "fresh",
          },
          status: "pass",
          checks: [
            {
              name: "assetType",
              status: "pass",
              classification: "verified",
              detail: "matched",
              subgraphValue: "ETH",
              viewsValue: "ETH",
            },
          ],
        };
      },
    });

    expect(result).toMatchObject({
      selectedNetwork: "both",
      status: "inconclusive",
      totalClusters: 2,
      totalChecks: 2,
      passedChecks: 1,
      warnedChecks: 0,
      inconclusiveChecks: 1,
      failedChecks: 0,
    });
    expect(renderVerifyClustersSummary(result)).toContain(`  - ${makeClusterId(12)}: INCONCLUSIVE checks=clusterState:INCONCLUSIVE(unavailable)`);
    expect(JSON.parse(renderVerifyClustersJson(result))).toMatchObject({
      status: "inconclusive",
      summary: expect.objectContaining({
        rootCauses: expect.objectContaining({ clusterState: 1 }),
      }),
    });
  });

  it("treats inconclusive batch results as non-zero aggregate outcomes", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    const result = await verifyAllClusters(config, {
      fetchClusterIds: async () => ({
        clusterIds: [makeClusterId(21)],
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
    })).toContain("- hoodi: INCONCLUSIVE clusters=1 clusterListingSource=primary");
  });

  it("preserves clusterState semantics for malformed discovered cluster ids", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    const result = await verifyAllClusters(config, {
      fetchClusterIds: async () => ({
        clusterIds: ["bad-cluster-id"],
        source: "primary",
      }),
      fetchFn: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { method?: string };

        if (body.method === "eth_blockNumber") {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x14" }), { status: 200 });
        }

        throw new Error("unexpected request");
      },
    });

    expect(result).toMatchObject({
      status: "fail",
      totalClusters: 1,
      inconclusiveChecks: 0,
      failedChecks: 1,
    });
    expect(result.clusterResults[0]).toMatchObject({
      clusterId: "bad-cluster-id",
      status: "fail",
      checks: [
        expect.objectContaining({
          name: "clusterState",
          status: "fail",
          reason: "invalid",
        }),
      ],
    });
  });


  it("limits per-network cluster verification concurrency to ten and preserves listing order", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    const ids = Array.from({ length: 12 }, (_, index) => makeClusterId(index + 1));
    const gates = ids.map(() => deferred<void>());
    const started: string[] = [];
    const maxInFlight = { value: 0 };
    let inFlight = 0;

    const runPromise = verifyAllClusters(config, {
      fetchClusterIds: async () => ({
        clusterIds: ids,
        source: "primary",
      }),
      verifyCluster: async (_runtimeConfig, id) => {
        const index = ids.indexOf(id);
        started.push(id);
        inFlight += 1;
        maxInFlight.value = Math.max(maxInFlight.value, inFlight);
        await gates[index]!.promise;
        inFlight -= 1;

        return {
          network: "hoodi",
          clusterId: id,
          subgraphSource: "primary",
          freshness: {
            indexedBlockNumber: 20,
            chainHeadBlockNumber: 20,
            lagBlocks: 0,
            status: "fresh",
          },
          status: "pass",
          checks: [
            {
              name: "clusterState",
              status: "pass",
              detail: "matched",
              subgraphValue: id,
            },
          ],
        };
      },
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(ids.slice(0, 10));
    expect(maxInFlight.value).toBe(10);

    for (let index = 9; index >= 0; index -= 1) {
      gates[index]!.resolve();
    }

    while (started.length < 12) {
      await Promise.resolve();
    }

    expect(started.slice(10)).toEqual(ids.slice(10));
    gates[10]!.resolve();
    gates[11]!.resolve();

    const result = await runPromise;

    expect(result.clusterResults.map((entry) => entry.clusterId)).toEqual(ids);
    expect(maxInFlight.value).toBe(10);
  });

  it("runs both networks concurrently while preserving configured network result order", async () => {
    const config = loadRuntimeConfig("both", baseEnv);
    const hoodiGate = deferred<void>();
    const mainnetGate = deferred<void>();
    const started: string[] = [];

    const runPromise = verifyClusters(config, {
      fetchClusterIds: async (primaryUrl) => {
        const network = primaryUrl.includes("hoodi") ? "hoodi" : "mainnet";
        started.push(`${network}:listing`);

        if (network === "hoodi") {
          await hoodiGate.promise;
        } else {
          await mainnetGate.promise;
        }

        return {
          clusterIds: [network === "hoodi" ? makeClusterId(101) : makeClusterId(201)],
          source: "primary",
        };
      },
      verifyCluster: async (runtimeConfig, id) => ({
        network: runtimeConfig.activeNetworks[0]!,
        clusterId: id,
        subgraphSource: "primary",
        freshness: {
          indexedBlockNumber: 20,
          chainHeadBlockNumber: 20,
          lagBlocks: 0,
          status: "fresh",
        },
        status: "pass",
        checks: [
          {
            name: "clusterState",
            status: "pass",
            detail: "matched",
            subgraphValue: id,
          },
        ],
      }),
    });

    await Promise.resolve();
    expect(started).toEqual(["hoodi:listing", "mainnet:listing"]);

    mainnetGate.resolve();
    await Promise.resolve();
    hoodiGate.resolve();

    const result = await runPromise;

    expect(result.networkResults.map((entry) => entry.network)).toEqual(["hoodi", "mainnet"]);
  });



  it("records network-level listing failures as discovery summary failures", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    const result = await verifyAllClusters(config, {
      fetchClusterIds: async () => {
        throw new Error("listing unavailable");
      },
    });

    expect(result).toMatchObject({
      network: "hoodi",
      status: "inconclusive",
      errorDetail: "listing unavailable",
      totalClusters: 0,
      summary: {
        rootCauses: {
          clusterState: 0,
          assetType: 0,
          daoData: 0,
          operatorData: 0,
          effectiveBalance: 0,
        },
        operational: { subgraphLag: 0 },
        discovery: { clusterListing: 1 },
      },
    });

    const listingFailureJson = JSON.parse(renderVerifyClustersJson({
      selectedNetwork: "hoodi",
      status: result.status,
      summary: result.summary,
      totalClusters: result.totalClusters,
      totalChecks: result.totalChecks,
      passedChecks: result.passedChecks,
      warnedChecks: result.warnedChecks,
      inconclusiveChecks: result.inconclusiveChecks,
      failedChecks: result.failedChecks,
      networkResults: [result],
    }));

    expect(listingFailureJson.networkResults[0]).toMatchObject({
      network: "hoodi",
      status: "inconclusive",
      summary: result.summary,
      clusterListingSource: "primary",
      errorDetail: "listing unavailable",
      clusterResults: [],
    });
  });



  it("renders root-cause/operational/discovery/error lines and only non-passing clusters", async () => {
    const config = loadRuntimeConfig("both", baseEnv);
    const result = await verifyClusters(config, {
      fetchClusterIds: async (primaryUrl) => {
        if (primaryUrl.includes("hoodi")) {
          return { clusterIds: [makeClusterId(31), makeClusterId(32)], source: "primary" };
        }

        throw new Error("listing unavailable");
      },
      verifyCluster: async (runtimeConfig, id) => ({
        network: runtimeConfig.activeNetworks[0]!,
        clusterId: id,
        subgraphSource: "primary",
        freshness: {
          indexedBlockNumber: 100,
          chainHeadBlockNumber: 110,
          lagBlocks: 10,
          status: "lagging",
        },
        status: id === makeClusterId(31) ? "pass" : "warn",
        checks: id === makeClusterId(31)
          ? [
              { name: "clusterState", kind: "input", status: "pass", reason: "matched", classification: "verified", detail: "matched", subgraphValue: id },
              { name: "subgraphLag", kind: "operational", status: "warn", reason: "lagging", classification: "lag-affected", detail: "lag", subgraphValue: "100", viewsValue: "110" },
            ]
          : [
              { name: "subgraphLag", kind: "operational", status: "warn", reason: "lagging", classification: "lag-affected", detail: "lag", subgraphValue: "100", viewsValue: "110" },
            ],
      }),
    });

    const text = renderVerifyClustersSummary(result);
    expect(text.split("\n").slice(0, 3)).toEqual([
      "verify-clusters INCONCLUSIVE",
      "network selection: both",
      "clusters: 2",
    ]);
    expect(text).toContain("operational: subgraphLag=2");
    expect(text).toContain("discovery: clusterListing=1");
    expect(text).toContain("- hoodi: WARN clusters=2 clusterListingSource=primary");
    expect(text).toContain("  operational: subgraphLag=2");
    expect(text).toContain("- mainnet: INCONCLUSIVE clusters=0 clusterListingSource=primary");
    expect(text).toContain("  discovery: clusterListing=1");
    expect(text).toContain("  error: listing unavailable");
    expect(text).toContain(`  - ${makeClusterId(32)}: WARN checks=subgraphLag:WARN(lagging)`);
    expect(text).not.toContain(makeClusterId(31));
  });

});
