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
      summary: {
        rootCauses: expect.objectContaining({
          clusterState: 0,
          assetType: 0,
          daoData: 0,
          operatorData: 0,
          effectiveBalance: 0,
          owner: 0,
          operatorIds: 0,
          validatorCount: 0,
          active: 0,
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
      summary: expect.objectContaining({
        rootCauses: expect.objectContaining({ owner: 2 }),
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
    expect(renderVerifyClustersSummary(result)).toContain("- hoodi: 0 passed / 1 warned / 0 inconclusive / 0 failed / 1 total");
    expect(renderVerifyClustersSummary(result)).toContain("- mainnet: 0 passed / 0 warned / 0 inconclusive / 1 failed / 1 total");
    expect(renderVerifyClustersSummary(result)).toContain(`hoodi/${makeClusterId(11)}: non-passing checks=owner:warn`);
    expect(renderVerifyClustersSummary(result)).toContain(`mainnet/${makeClusterId(12)}: non-passing checks=owner:fail`);
    expect(JSON.parse(renderVerifyClustersJson(result))).toMatchObject({
      selectedNetwork: "both",
      status: "fail",
      totalClusters: 2,
      summary: expect.objectContaining({
        rootCauses: expect.objectContaining({ owner: 2 }),
      }),
      networkResults: [
        {
          network: "hoodi",
          clusterResults: [
            {
              clusterId: makeClusterId(11),
              status: "warn",
            },
          ],
        },
        {
          network: "mainnet",
          clusterResults: [
            {
              clusterId: makeClusterId(12),
              status: "fail",
            },
          ],
        },
      ],
    });
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
              name: "owner",
              status: "pass",
              classification: "verified",
              detail: "matched",
              subgraphValue: "0x1",
              viewsValue: "0x1",
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
    expect(renderVerifyClustersSummary(result)).toContain(`mainnet/${makeClusterId(12)}: non-passing checks=clusterState:inconclusive`);
    expect(renderVerifyClustersJson(result)).toContain('"inconclusiveChecks": 1');
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
    })).toContain("1 inconclusive");
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
          owner: 0,
          operatorIds: 0,
          validatorCount: 0,
          active: 0,
        },
        operational: { subgraphLag: 0 },
        discovery: { clusterListing: 1 },
      },
    });
  });

});
