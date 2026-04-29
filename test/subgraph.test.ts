import { describe, expect, it } from "vitest";

import {
  fetchAllSubgraphOperatorDetails,
  fetchPinnedSubgraphClusterSnapshot,
} from "../src/clients/subgraph.js";

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

describe("fetchAllSubgraphOperatorDetails", () => {
  it("paginates and returns full operator details", async () => {
    const pageSize = 1000;
    const firstPage = Array.from({ length: pageSize }, (_, index) => ({
      id: String(index + 1),
      fee: String((index + 1) * 10),
      feeSSV: String((index + 1) * 11),
      validatorCount: String((index + 1) * 2),
      removed: false,
    }));
    const secondPage = [
      { id: "1001", fee: "10010", feeSSV: "10011", validatorCount: "42", removed: true },
    ];
    const seenSkips: number[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
      expect(String(input)).toBe("https://primary.example");
      const body = JSON.parse(String(init?.body)) as { query: string; variables: { first: number; skip: number } };
      expect(body.query).toContain("operators(first: $first, skip: $skip");
      expect(body.query).toContain("removed");
      expect(body.query).not.toContain("operator(id:");
      seenSkips.push(body.variables.skip);
      const operators = body.variables.skip === 0 ? firstPage : body.variables.skip === pageSize ? secondPage : [];
      return new Response(JSON.stringify({ data: { operators } }), { status: 200 });
    };

    const result = await fetchAllSubgraphOperatorDetails("https://primary.example", undefined, fetchFn);

    expect(seenSkips).toEqual([0, pageSize]);
    expect(result.source).toBe("primary");
    expect(result.operators).toHaveLength(pageSize + 1);
    expect(result.operators[0]).toEqual({ id: "1", fee: "10", feeSSV: "11", validatorCount: "2", removed: false });
    expect(result.operators.at(-1)).toEqual({ id: "1001", fee: "10010", feeSSV: "10011", validatorCount: "42", removed: true });
  });

  it("falls back when the primary subgraph fails", async () => {
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      if (url === "https://primary.example") {
        return new Response(JSON.stringify({ errors: [{ message: "primary down" }] }), { status: 200 });
      }
      if (url === "https://fallback.example") {
        return new Response(
          JSON.stringify({
            data: {
              operators: [
                { id: "7", fee: "70", feeSSV: "77", validatorCount: "3", removed: false },
              ],
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected url: ${url}`);
    };

    const result = await fetchAllSubgraphOperatorDetails("https://primary.example", "https://fallback.example", fetchFn);

    expect(result.source).toBe("fallback");
    expect(result.operators).toEqual([
      { id: "7", fee: "70", feeSSV: "77", validatorCount: "3", removed: false },
    ]);
  });
});
