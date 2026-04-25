import { describe, expect, it } from "vitest";

import { fetchPinnedSubgraphClusterSnapshot } from "../src/clients/subgraph.js";

const clusterId = "0xe8c927a1fa792eddefe23fda643a62e03f999830-5-6-7-523";
const daoAddress = "0x58410bef803ecd7e63b23664c586a6db72daf59c";

function createPrimaryClusterPayload(cluster: object | null): Response {
  return new Response(
    JSON.stringify({
      data: {
        _meta: { block: { number: 123 } },
        cluster,
      },
    }),
    { status: 200 },
  );
}

describe("fetchPinnedSubgraphClusterSnapshot", () => {
  it("returns a pinned cluster snapshot with accounting inputs", async () => {
    const fetchFn: typeof fetch = async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };

      if (url === "https://primary.example" && body.query.includes("_meta") && body.query.includes("cluster(id: $id)")) {
        expect(body.variables).toEqual({ id: clusterId });
        return createPrimaryClusterPayload({
          id: clusterId,
          owner: { id: "0xe8c927a1fa792eddefe23fda643a62e03f999830" },
          operatorIds: ["5", "6", "7", "523"],
          validatorCount: "1",
          networkFeeIndex: "10",
          index: "20",
          active: true,
          balance: "30",
          feeAsset: "SSV",
          effectiveBalance: null,
        });
      }

      if (url === "https://primary.example" && body.query.includes("operators(where: { id_in: $operatorIds })")) {
        expect(body.variables).toEqual({ operatorIds: ["5", "6", "7", "523"], daoId: daoAddress });
        return new Response(
          JSON.stringify({
            data: {
              operators: [
                { id: "5", fee: "1", feeIndex: "2", feeIndexBlockNumber: "3" },
                { id: "6", fee: "4", feeIndex: "5", feeIndexBlockNumber: "6" },
                { id: "7", fee: "7", feeIndex: "8", feeIndexBlockNumber: "9" },
                { id: "523", fee: "10", feeIndex: "11", feeIndexBlockNumber: "12" },
              ],
              daovalues: {
                networkFee: "13",
                networkFeeIndex: "14",
                networkFeeIndexBlockNumber: "15",
                liquidationThreshold: "16",
                minimumLiquidationCollateral: "17",
                networkFeeSSV: "18",
                networkFeeIndexSSV: "19",
                networkFeeIndexBlockNumberSSV: "20",
                liquidationThresholdSSV: "21",
                minimumLiquidationCollateralSSV: "22",
              },
            },
          }),
          { status: 200 },
        );
      }

      throw new Error(`Unexpected request: ${url} ${body.query}`);
    };

    await expect(
      fetchPinnedSubgraphClusterSnapshot("https://primary.example", undefined, clusterId, daoAddress, fetchFn),
    ).resolves.toMatchObject({
      status: "success",
      source: "primary",
      indexedBlockNumber: 123,
      cluster: {
        id: clusterId,
      },
      operators: [{ id: "5" }, { id: "6" }, { id: "7" }, { id: "523" }],
      daoValues: {
        networkFee: "13",
        minimumLiquidationCollateralSSV: "22",
      },
    });
  });

  it("returns a structured not-found result with block context", async () => {
    let fallbackCalled = false;
    const fetchFn: typeof fetch = async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as { query: string };

      if (url === "https://fallback.example") {
        fallbackCalled = true;
      }

      if (body.query.includes("_meta") && body.query.includes("cluster(id: $id)")) {
        return createPrimaryClusterPayload(null);
      }

      throw new Error(`Unexpected request: ${url} ${body.query}`);
    };

    await expect(
      fetchPinnedSubgraphClusterSnapshot("https://primary.example", "https://fallback.example", clusterId, daoAddress, fetchFn),
    ).resolves.toEqual({
      status: "not-found",
      clusterId,
      indexedBlockNumber: 123,
      source: "primary",
    });
    expect(fallbackCalled).toBe(false);
  });

  it("falls back on primary query failure", async () => {
    const fetchFn: typeof fetch = async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as { query: string };

      if (url === "https://primary.example") {
        return new Response(JSON.stringify({ errors: [{ message: "primary down" }] }), { status: 200 });
      }

      if (body.query.includes("_meta") && body.query.includes("cluster(id: $id)")) {
        return new Response(
          JSON.stringify({
            data: {
              _meta: { block: { number: 456 } },
              cluster: {
                id: clusterId,
                owner: { id: "0xe8c927a1fa792eddefe23fda643a62e03f999830" },
                operatorIds: ["5", "6", "7", "523"],
                validatorCount: "1",
                networkFeeIndex: "10",
                index: "20",
                active: true,
                balance: "30",
                feeAsset: "SSV",
                effectiveBalance: null,
              },
            },
          }),
          { status: 200 },
        );
      }

      if (body.query.includes("operators(where: { id_in: $operatorIds })")) {
        return new Response(
          JSON.stringify({
            data: {
              operators: [],
              daovalues: null,
            },
          }),
          { status: 200 },
        );
      }

      throw new Error(`Unexpected request: ${url} ${body.query}`);
    };

    await expect(
      fetchPinnedSubgraphClusterSnapshot("https://primary.example", "https://fallback.example", clusterId, daoAddress, fetchFn),
    ).resolves.toMatchObject({
      status: "success",
      source: "fallback",
      indexedBlockNumber: 456,
      daoValues: null,
      operators: [],
    });
  });

  it("returns a structured query failure when all sources fail", async () => {
    const fetchFn: typeof fetch = async (_input) => {
      return new Response(JSON.stringify({ errors: [{ message: "subgraph timeout" }] }), { status: 200 });
    };

    await expect(
      fetchPinnedSubgraphClusterSnapshot("https://primary.example", "https://fallback.example", clusterId, daoAddress, fetchFn),
    ).resolves.toEqual({
      status: "query-failed",
      detail: "Subgraph query failed: subgraph timeout",
      source: "fallback",
    });
  });
});
