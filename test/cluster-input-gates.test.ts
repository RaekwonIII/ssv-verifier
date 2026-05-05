import { describe, expect, it } from "vitest";

import { verifyClusterIdentity } from "../src/commands/verify-cluster.js";
import { loadRuntimeConfig } from "../src/config/env.js";

const baseEnv = {
  MAINNET_RPC_URL: "https://mainnet.example",
  HOODI_RPC_URL: "https://hoodi.example",
  MAINNET_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000001",
  HOODI_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000002",
  MAINNET_SUBGRAPH_URL: "https://api.studio.thegraph.com/query/71118/ssv-network-ethereum/version/latest",
  HOODI_SUBGRAPH_URL: "https://api.studio.thegraph.com/query/71118/ssv-network-hoodi/version/latest",
};

const clusterId = "0xe8c927a1fa792eddefe23fda643a62e03f999830-5-6-7-523";

function encodeWord(value: bigint | boolean): string {
  const normalized = typeof value === "boolean" ? (value ? 1n : 0n) : value;
  return `0x${normalized.toString(16).padStart(64, "0")}`;
}

interface ClusterPayload {
  feeAsset: "ETH" | "SSV" | null | string;
  effectiveBalance?: string | null;
  validatorCount?: string;
  active?: boolean;
}

function createFetch(options: {
  cluster: ClusterPayload;
  operators: Array<Record<string, string | null>>;
  daoValues?: Record<string, string | null>;
  onChainAsset?: 0n | 1n | 2n;
}): typeof fetch {
  const {
    cluster,
    operators,
    daoValues,
    onChainAsset = cluster.feeAsset === "ETH" ? 1n : 0n,
  } = options;

  let ethCallCount = 0;

  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

    if (body.method === "eth_blockNumber") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x14" }), { status: 200 });
    }

    if (body.method === "eth_call") {
      ethCallCount += 1;

      if (ethCallCount === 1) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeWord(onChainAsset) }), { status: 200 });
      }

      if (ethCallCount === 2) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeWord(false) }), { status: 200 });
      }

      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: IncorrectClusterState" } }),
        { status: 200 },
      );
    }

    if (body.query?.includes("_meta")) {
      return new Response(JSON.stringify({ data: { _meta: { block: { number: 20 } } } }), { status: 200 });
    }

    if (body.query?.includes("cluster(id: $id)")) {
      return new Response(
        JSON.stringify({
          data: {
            cluster: {
              id: clusterId,
              owner: { id: "0xe8c927a1fa792eddefe23fda643a62e03f999830" },
              operatorIds: ["5", "6", "7", "523"],
              validatorCount: cluster.validatorCount ?? "1",
              networkFeeIndex: "10",
              index: "20",
              active: cluster.active ?? true,
              balance: "30",
              feeAsset: cluster.feeAsset,
              effectiveBalance: cluster.effectiveBalance ?? null,
            },
          },
        }),
        { status: 200 },
      );
    }

    if (body.query?.includes("daovalues(id: $daoId)")) {
      return new Response(
        JSON.stringify({
          data: {
            operators,
            daovalues: daoValues ?? {
              networkFee: "0",
              networkFeeIndex: "10",
              networkFeeIndexBlockNumber: "20",
              liquidationThreshold: "1",
              minimumLiquidationCollateral: "1",
              networkFeeSSV: "0",
              networkFeeIndexSSV: "100000000",
              networkFeeIndexBlockNumberSSV: "20",
              liquidationThresholdSSV: "1",
              minimumLiquidationCollateralSSV: "1",
            },
          },
        }),
        { status: 200 },
      );
    }

    throw new Error(`Unexpected request payload: ${JSON.stringify(body)}`);
  };
}

const config = loadRuntimeConfig("hoodi", baseEnv);

describe("cluster input gates", () => {
  it("fails assetType when subgraph feeAsset is invalid and blocks downstream input checks", async () => {
    const result = await verifyClusterIdentity(config, clusterId, {
      fetchFn: createFetch({
        cluster: { feeAsset: "BAD" },
        operators: [],
        onChainAsset: 1n,
      }),
    });

    const assetType = result.checks.find((check) => check.name === "assetType");
    expect(assetType).toMatchObject({ status: "fail", reason: "mismatch" });
    expect(result.status).toBe("fail");

    const operatorData = result.checks.find((check) => check.name === "operatorData");
    expect(operatorData).toMatchObject({ status: "inconclusive", reason: "blocked", blockedBy: ["assetType"] });
  });

  it("emits assetType inconclusive when on-chain asset enum is unknown", async () => {
    const result = await verifyClusterIdentity(config, clusterId, {
      fetchFn: createFetch({
        cluster: { feeAsset: "SSV" },
        operators: [],
        onChainAsset: 2n,
      }),
    });

    const assetType = result.checks.find((check) => check.name === "assetType");
    expect(assetType).toMatchObject({ status: "fail", reason: "mismatch" });
  });

  it("omits effectiveBalance for SSV clusters and fails ETH effectiveBalance when missing", async () => {
    const ssvResult = await verifyClusterIdentity(config, clusterId, {
      fetchFn: createFetch({
        cluster: { feeAsset: "SSV" },
        operators: [
          { id: "5", fee: "0", feeIndex: "10", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "100000000", feeIndexBlockNumberSSV: "20" },
          { id: "6", fee: "0", feeIndex: "5", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "50000000", feeIndexBlockNumberSSV: "20" },
          { id: "7", fee: "0", feeIndex: "3", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "30000000", feeIndexBlockNumberSSV: "20" },
          { id: "523", fee: "0", feeIndex: "2", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "20000000", feeIndexBlockNumberSSV: "20" },
        ],
      }),
    });

    expect(ssvResult.checks.find((check) => check.name === "effectiveBalance")).toBeUndefined();

    const ethResult = await verifyClusterIdentity(config, clusterId, {
      fetchFn: createFetch({
        cluster: { feeAsset: "ETH", effectiveBalance: null },
        operators: [
          { id: "5", fee: "0", feeIndex: "10", feeIndexBlockNumber: "20" },
          { id: "6", fee: "0", feeIndex: "5", feeIndexBlockNumber: "20" },
          { id: "7", fee: "0", feeIndex: "3", feeIndexBlockNumber: "20" },
          { id: "523", fee: "0", feeIndex: "2", feeIndexBlockNumber: "20" },
        ],
      }),
    });

    const effectiveBalance = ethResult.checks.find((check) => check.name === "effectiveBalance");
    expect(effectiveBalance).toMatchObject({ status: "fail", subgraphValue: "missing" });
  });

  it("omits operatorData for empty clusters and keeps daoData", async () => {
    const result = await verifyClusterIdentity(config, clusterId, {
      fetchFn: createFetch({
        cluster: { feeAsset: "SSV", validatorCount: "0", active: true },
        operators: [],
      }),
    });

    expect(result.checks.find((check) => check.name === "operatorData")).toBeUndefined();
    expect(result.checks.find((check) => check.name === "daoData")).toMatchObject({ status: "pass" });
  });

  it("makes operatorData inconclusive when an expected operator record is missing", async () => {
    const result = await verifyClusterIdentity(config, clusterId, {
      fetchFn: createFetch({
        cluster: { feeAsset: "SSV" },
        operators: [
          { id: "5", fee: "0", feeIndex: "10", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "100000000", feeIndexBlockNumberSSV: "20" },
          { id: "6", fee: "0", feeIndex: "5", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "50000000", feeIndexBlockNumberSSV: "20" },
          { id: "7", fee: "0", feeIndex: "3", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "30000000", feeIndexBlockNumberSSV: "20" },
        ],
      }),
    });

    const operatorData = result.checks.find((check) => check.name === "operatorData");
    expect(operatorData).toMatchObject({ status: "inconclusive" });
    expect(operatorData?.detail).toMatch(/operator 523 record/);
  });
});
