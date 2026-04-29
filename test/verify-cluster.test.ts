import { describe, expect, it } from "vitest";

import {
  renderVerifyClusterJson,
  renderVerifyClusterSummary,
  verifyClusterIdentity,
} from "../src/commands/verify-cluster.js";
import { loadRuntimeConfig } from "../src/config/env.js";
import { parseCliArgs } from "../src/index.js";

const baseEnv = {
  MAINNET_RPC_URL: "https://mainnet.example",
  HOODI_RPC_URL: "https://hoodi.example",
  MAINNET_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000001",
  HOODI_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000002",
};

const clusterId = "0xe8c927a1fa792eddefe23fda643a62e03f999830-5-6-7-523";

function encodeRpcWord(value: bigint | boolean): string {
  const normalized = typeof value === "boolean" ? (value ? 1n : 0n) : value;
  return `0x${normalized.toString(16).padStart(64, "0")}`;
}

function createEmptyClusterFetchFn(options: {
  asset: "ETH" | "SSV";
  clusterBalance?: string;
  active?: boolean;
  effectiveBalance?: string | null;
  viewsBalance?: bigint;
  viewsBurnRate?: bigint;
  viewsLiquidatable?: boolean;
  viewsLiquidationThreshold?: bigint;
  viewsMinimumCollateral?: bigint;
  operators?: Array<Record<string, string | null>>;
}): typeof fetch {
  const {
    asset,
    clusterBalance = "30",
    active = true,
    effectiveBalance = null,
    viewsBalance = BigInt(clusterBalance),
    viewsBurnRate = 0n,
    viewsLiquidatable = false,
    viewsLiquidationThreshold = 1n,
    viewsMinimumCollateral = 1n,
    operators = [],
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
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeRpcWord(asset === "ETH") }), { status: 200 });
      }

      if (ethCallCount === 2) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeRpcWord(0n) }), { status: 200 });
      }

      if (ethCallCount >= 3 && ethCallCount <= 6) {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: IncorrectClusterState" } }),
          { status: 200 },
        );
      }

      if (ethCallCount === 7) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeRpcWord(viewsBalance) }), { status: 200 });
      }

      if (ethCallCount === 8) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeRpcWord(viewsBurnRate) }), { status: 200 });
      }

      if (ethCallCount === 9) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeRpcWord(viewsLiquidatable) }), { status: 200 });
      }

      if (ethCallCount === 10) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeRpcWord(viewsLiquidationThreshold) }), { status: 200 });
      }

      if (ethCallCount === 11) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeRpcWord(viewsMinimumCollateral) }), { status: 200 });
      }

      throw new Error(`Unexpected eth_call #${ethCallCount}`);
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
              validatorCount: "0",
              networkFeeIndex: "10",
              index: "20",
              active,
              balance: clusterBalance,
              feeAsset: asset,
              effectiveBalance,
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
            daovalues: {
              networkFee: "64",
              networkFeeIndex: "10",
              networkFeeIndexBlockNumber: "20",
              liquidationThreshold: viewsLiquidationThreshold.toString(),
              minimumLiquidationCollateral: viewsMinimumCollateral.toString(),
              networkFeeSSV: "64",
              networkFeeIndexSSV: "10",
              networkFeeIndexBlockNumberSSV: "20",
              liquidationThresholdSSV: viewsLiquidationThreshold.toString(),
              minimumLiquidationCollateralSSV: viewsMinimumCollateral.toString(),
            },
          },
        }),
        { status: 200 },
      );
    }

    throw new Error(`Unexpected request payload: ${JSON.stringify(body)}`);
  };
}

describe("parseCliArgs verify-cluster", () => {
  it("parses the verify-cluster command", () => {
    expect(parseCliArgs(["verify-cluster", "--network", "hoodi", "--cluster", clusterId])).toEqual({
      command: "verify-cluster",
      network: "hoodi",
      clusterId,
      output: "text",
    });
  });

  it("parses json output mode for verify-cluster", () => {
    expect(parseCliArgs(["verify-cluster", "--network", "hoodi", "--cluster", clusterId, "--output", "json"])).toEqual({
      command: "verify-cluster",
      network: "hoodi",
      clusterId,
      output: "json",
    });
  });

  it("rejects verify-cluster with --network both", () => {
    expect(() => parseCliArgs(["verify-cluster", "--network", "both", "--cluster", clusterId])).toThrow(
      /verify-cluster does not support --network both/
    );
  });

  it("rejects verify-cluster with an irrelevant --operator flag", () => {
    expect(() => parseCliArgs(["verify-cluster", "--network", "hoodi", "--cluster", clusterId, "--operator", "17"])).toThrow(
      /does not accept --operator/
    );
  });
});

describe("verify-cluster command integration", () => {
  it("verifies empty SSV clusters without emitting operatorData", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    const result = await verifyClusterIdentity(config, clusterId, {
      fetchFn: createEmptyClusterFetchFn({ asset: "SSV" }),
    });

    expect(result.status).toBe("pass");
    expect(result.checks.find((check) => check.name === "operatorData")).toBeUndefined();
    expect(result.checks.find((check) => check.name === "currentBalance")).toMatchObject({
      subgraphValue: "30",
      viewsValue: "30",
      status: "pass",
    });
    expect(result.checks.find((check) => check.name === "burnRate")).toMatchObject({
      subgraphValue: "0",
      viewsValue: "0",
      status: "pass",
    });
    expect(result.checks.find((check) => check.name === "liquidationCollateral")).toMatchObject({
      subgraphValue: "1",
      viewsValue: "1",
      status: "pass",
    });
    expect(result.checks.find((check) => check.name === "liquidatable")).toMatchObject({
      subgraphValue: "false",
      viewsValue: "false",
      status: "pass",
    });
  });

  it("treats empty-cluster views mismatches as normal failures", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    const result = await verifyClusterIdentity(config, clusterId, {
      fetchFn: createEmptyClusterFetchFn({ asset: "SSV", viewsBalance: 29n }),
    });

    expect(result.status).toBe("fail");
    expect(result.checks.find((check) => check.name === "operatorData")).toBeUndefined();
    expect(result.checks.find((check) => check.name === "currentBalance")).toMatchObject({
      subgraphValue: "30",
      viewsValue: "29",
      status: "fail",
      classification: "mismatch",
    });
  });

  it("verifies empty ETH clusters without emitting operatorData or effectiveBalance", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    const result = await verifyClusterIdentity(config, clusterId, {
      fetchFn: createEmptyClusterFetchFn({ asset: "ETH", effectiveBalance: null }),
    });

    expect(result.status).toBe("pass");
    expect(result.checks.find((check) => check.name === "operatorData")).toBeUndefined();
    expect(result.checks.find((check) => check.name === "effectiveBalance")).toBeUndefined();
    expect(result.checks.find((check) => check.name === "currentBalance")).toMatchObject({
      subgraphValue: "30",
      viewsValue: "30",
      status: "pass",
    });
    expect(result.checks.find((check) => check.name === "burnRate")).toMatchObject({
      subgraphValue: "0",
      viewsValue: "0",
      status: "pass",
    });
  });

  it("reports a successful comparison flow", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    let ethCallCount = 0;
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

      if (body.method === "eth_blockNumber") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x14" }), { status: 200 });
      }

      if (body.method === "eth_call") {
        ethCallCount += 1;

        if (ethCallCount === 1) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount === 2) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }),
            { status: 200 },
          );
        }

        if (ethCallCount >= 3 && ethCallCount <= 6) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: IncorrectClusterState" } }),
            { status: 200 },
          );
        }

        if (ethCallCount === 7) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x000000000000000000000000000000000000000000000000000000000000001e" }), { status: 200 });
        }

        if (ethCallCount === 8) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount === 9) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount === 10) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
        }

        if (ethCallCount === 11) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
        }

        if (ethCallCount === 9) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount === 10) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
        }

        if (ethCallCount === 11) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
        }

        if (ethCallCount === 9) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount === 10) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
        }

        if (ethCallCount === 11) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
        }

        throw new Error(`Unexpected eth_call #${ethCallCount}`);
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
                validatorCount: "1",
                networkFeeIndex: "10",
                index: "20",
                active: true,
                balance: "30",
                feeAsset: "SSV",
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
              operators: [
                { id: "5", fee: "0", feeIndex: "10", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "10", feeIndexBlockNumberSSV: "20" },
                { id: "6", fee: "0", feeIndex: "5", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "5", feeIndexBlockNumberSSV: "20" },
                { id: "7", fee: "0", feeIndex: "3", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "3", feeIndexBlockNumberSSV: "20" },
                { id: "523", fee: "0", feeIndex: "2", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "2", feeIndexBlockNumberSSV: "20" },
              ],
              daovalues: {
                networkFee: "0",
                networkFeeIndex: "10",
                networkFeeIndexBlockNumber: "20",
                liquidationThreshold: "1",
                minimumLiquidationCollateral: "1",
                networkFeeSSV: "0",
                networkFeeIndexSSV: "10",
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

    const result = await verifyClusterIdentity(config, clusterId, { fetchFn });

    expect(result.status).toBe("pass");
    expect(result.freshness).toMatchObject({
      indexedBlockNumber: 20,
      chainHeadBlockNumber: 20,
      lagBlocks: 0,
      status: "fresh",
    });
    expect(result.checks).toHaveLength(13);
    expect(result.checks.find((check) => check.name === "clusterState")).toMatchObject({
      subgraphValue: clusterId,
      status: "pass",
    });
    expect(result.checks.find((check) => check.name === "assetType")).toMatchObject({
      subgraphValue: "SSV",
      viewsValue: "SSV",
      status: "pass",
    });
    expect(result.checks.find((check) => check.name === "daoData")).toMatchObject({
      subgraphValue: "SSV",
      status: "pass",
    });
    expect(result.checks.find((check) => check.name === "operatorData")).toMatchObject({
      subgraphValue: "SSV",
      status: "pass",
    });
    expect(result.checks.find((check) => check.name === "subgraphLag")).toMatchObject({
      status: "pass",
      subgraphValue: "20",
      viewsValue: "20",
    });
    expect(result.checks.every((check) => check.status === "pass")).toBe(true);
    expect(result.checks.find((check) => check.name === "currentBalance")).toMatchObject({
      subgraphValue: "30",
      viewsValue: "30",
      status: "pass",
    });
    expect(result.checks.find((check) => check.name === "burnRate")).toMatchObject({
      subgraphValue: "0",
      viewsValue: "0",
      status: "pass",
    });
    expect(result.checks.find((check) => check.name === "liquidatable")).toMatchObject({
      subgraphValue: "false",
      viewsValue: "false",
      status: "pass",
    });
    const textSummary = renderVerifyClusterSummary(result);
    expect(textSummary.split("\n").slice(0, 8)).toEqual([
      "verify-cluster PASS",
      "network: hoodi",
      `cluster: ${clusterId}`,
      "subgraph source: primary",
      "verification block: 20",
      "chain head: 20",
      "subgraph lag: 0 block(s) (fresh)",
      "checks:",
    ]);
    expect(textSummary).toContain("- clusterState: PASS kind=input reason=matched local=");
    expect(textSummary).toContain("- currentBalance: PASS kind=derived reason=matched local=30 views=30");
    expect(textSummary).not.toContain("accountingDebug");
    expect(textSummary).not.toContain("classification");
    const publicJson = JSON.parse(renderVerifyClusterJson(result));
    expect(publicJson).toMatchObject({
      network: "hoodi",
      clusterId,
      verificationBlock: 20,
      status: "pass",
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: "currentBalance",
          kind: "derived",
          status: "pass",
          reason: "matched",
          localValue: "30",
          viewsValue: "30",
        }),
      ]),
      accountingDebug: expect.objectContaining({
        selectedAsset: "SSV",
        localInputs: expect.any(Object),
        viewsInputs: expect.objectContaining({ blockTag: "0x14" }),
        intermediates: expect.any(Object),
      }),
    });
    expect(publicJson.freshness).toBeUndefined();
    expect(publicJson.checks[0].classification).toBeUndefined();
    expect(publicJson.checks[0].subgraphValue).toBeUndefined();
  });

  it("reports pinned Views read failures as per-check inconclusive outcomes", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    let ethCallCount = 0;
    const derivedBlockTags: string[] = [];
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string; query?: string; params?: unknown[] };

      if (body.method === "eth_blockNumber") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x16" }), { status: 200 });
      }

      if (body.method === "eth_call") {
        ethCallCount += 1;

        if (ethCallCount >= 7) {
          derivedBlockTags.push(String(body.params?.[1] ?? "missing"));
        }

        if (ethCallCount === 1) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeRpcWord(0n) }), { status: 200 });
        }

        if (ethCallCount === 2) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeRpcWord(0n) }), { status: 200 });
        }

        if (ethCallCount >= 3 && ethCallCount <= 6) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: IncorrectClusterState" } }),
            { status: 200 },
          );
        }

        if (ethCallCount === 7) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeRpcWord(30n) }), { status: 200 });
        }

        if (ethCallCount === 8) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: burn read failed" } }),
            { status: 200 },
          );
        }

        if (ethCallCount === 9) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeRpcWord(false) }), { status: 200 });
        }

        if (ethCallCount === 10) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeRpcWord(1n) }), { status: 200 });
        }

        if (ethCallCount === 11) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeRpcWord(1n) }), { status: 200 });
        }

        throw new Error(`Unexpected eth_call #${ethCallCount}`);
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
                validatorCount: "1",
                networkFeeIndex: "10",
                index: "20",
                active: true,
                balance: "30",
                feeAsset: "SSV",
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
              operators: [
                { id: "5", fee: "0", feeIndex: "10", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "10", feeIndexBlockNumberSSV: "20" },
                { id: "6", fee: "0", feeIndex: "5", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "5", feeIndexBlockNumberSSV: "20" },
                { id: "7", fee: "0", feeIndex: "3", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "3", feeIndexBlockNumberSSV: "20" },
                { id: "523", fee: "0", feeIndex: "2", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "2", feeIndexBlockNumberSSV: "20" },
              ],
              daovalues: {
                networkFee: "0",
                networkFeeIndex: "10",
                networkFeeIndexBlockNumber: "20",
                liquidationThreshold: "1",
                minimumLiquidationCollateral: "1",
                networkFeeSSV: "0",
                networkFeeIndexSSV: "10",
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

    const result = await verifyClusterIdentity(config, clusterId, { fetchFn });

    expect(result.status).toBe("inconclusive");
    expect(derivedBlockTags).toEqual(["0x14", "0x14", "0x14", "0x14", "0x14"]);
    expect(result.checks.find((check) => check.name === "currentBalance")).toMatchObject({
      status: "pass",
      subgraphValue: "30",
      viewsValue: "30",
    });
    expect(result.checks.find((check) => check.name === "burnRate")).toMatchObject({
      status: "inconclusive",
      classification: "inconclusive",
      subgraphValue: "0",
      diagnostics: [
        expect.objectContaining({
          kind: "viewsReadFailed",
          read: "getBurnRate",
          blockTag: "0x14",
        }),
      ],
    });
    expect(result.checks.find((check) => check.name === "liquidationCollateral")).toMatchObject({
      status: "inconclusive",
      classification: "inconclusive",
      subgraphValue: "1",
      diagnostics: [
        expect.objectContaining({
          kind: "viewsReadFailed",
          read: "getBurnRate",
          blockTag: "0x14",
        }),
      ],
    });
    expect(result.checks.find((check) => check.name === "liquidatable")).toMatchObject({
      status: "pass",
      subgraphValue: "false",
      viewsValue: "false",
    });
  });

  it("reports a current balance mismatch", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    let ethCallCount = 0;
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

      if (body.method === "eth_blockNumber") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x14" }), { status: 200 });
      }

      if (body.method === "eth_call") {
        ethCallCount += 1;

        if (ethCallCount === 1) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount === 2) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }),
            { status: 200 },
          );
        }

        if (ethCallCount >= 3 && ethCallCount <= 6) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: IncorrectClusterState" } }),
            { status: 200 },
          );
        }

        if (ethCallCount === 7) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x000000000000000000000000000000000000000000000000000000000000001d" }), { status: 200 });
        }

        if (ethCallCount === 8) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount === 9) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount === 10) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
        }

        if (ethCallCount === 11) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
        }

        throw new Error(`Unexpected eth_call #${ethCallCount}`);
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
                validatorCount: "1",
                networkFeeIndex: "10",
                index: "20",
                active: true,
                balance: "30",
                feeAsset: "SSV",
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
              operators: [
                { id: "5", fee: "0", feeIndex: "10", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "10", feeIndexBlockNumberSSV: "20" },
                { id: "6", fee: "0", feeIndex: "5", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "5", feeIndexBlockNumberSSV: "20" },
                { id: "7", fee: "0", feeIndex: "3", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "3", feeIndexBlockNumberSSV: "20" },
                { id: "523", fee: "0", feeIndex: "2", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "2", feeIndexBlockNumberSSV: "20" },
              ],
              daovalues: {
                networkFee: "0",
                networkFeeIndex: "10",
                networkFeeIndexBlockNumber: "20",
                liquidationThreshold: "1",
                minimumLiquidationCollateral: "1",
                networkFeeSSV: "0",
                networkFeeIndexSSV: "10",
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

    const result = await verifyClusterIdentity(config, clusterId, { fetchFn });
    const balanceCheck = result.checks.find((check) => check.name === "currentBalance");

    expect(result.status).toBe("fail");
    expect(result.freshness.status).toBe("fresh");
    expect(balanceCheck).toMatchObject({
      subgraphValue: "30",
      viewsValue: "29",
      status: "fail",
      classification: "mismatch",
    });
    expect(renderVerifyClusterSummary(result)).toContain("currentBalance: FAIL kind=derived reason=mismatch local=30 views=29");
    expect(JSON.parse(renderVerifyClusterJson(result))).toMatchObject({
      network: "hoodi",
      clusterId,
      status: "fail",
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: "currentBalance",
          kind: "derived",
          status: "fail",
          reason: "mismatch",
          localValue: "30",
          viewsValue: "29",
        }),
      ]),
    });
  });

  it("fails asset-type mismatches and blocks downstream accounting checks", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    let ethCallCount = 0;
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

      if (body.method === "eth_blockNumber") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x14" }), { status: 200 });
      }

      if (body.method === "eth_call") {
        ethCallCount += 1;

        if (ethCallCount === 1) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
        }

        throw new Error(`Unexpected eth_call #${ethCallCount}`);
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
                validatorCount: "1",
                networkFeeIndex: "10",
                index: "20",
                active: true,
                balance: "30",
                feeAsset: "SSV",
                effectiveBalance: "64",
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
              operators: [
                { id: "5", fee: "0", feeIndex: "10", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "10", feeIndexBlockNumberSSV: "20" },
                { id: "6", fee: "0", feeIndex: "5", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "5", feeIndexBlockNumberSSV: "20" },
                { id: "7", fee: "0", feeIndex: "3", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "3", feeIndexBlockNumberSSV: "20" },
                { id: "523", fee: "0", feeIndex: "2", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "2", feeIndexBlockNumberSSV: "20" },
              ],
              daovalues: {
                networkFee: "0",
                networkFeeIndex: "10",
                networkFeeIndexBlockNumber: "20",
                liquidationThreshold: "1",
                minimumLiquidationCollateral: "1",
                networkFeeSSV: "0",
                networkFeeIndexSSV: "10",
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

    const result = await verifyClusterIdentity(config, clusterId, { fetchFn });

    expect(result.status).toBe("fail");
    expect(result.checks.find((check) => check.name === "assetType")).toMatchObject({
      status: "fail",
      subgraphValue: "SSV",
      viewsValue: "ETH",
    });
    expect(result.checks.find((check) => check.name === "owner")).toMatchObject({
      status: "inconclusive",
    });
    expect(result.checks.find((check) => check.name === "currentBalance")).toMatchObject({
      status: "inconclusive",
    });
    expect(result.checks.find((check) => check.name === "burnRate")).toMatchObject({
      status: "inconclusive",
    });
  });

  it("checks ETH effective balance before later ETH accounting slices", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    let ethCallCount = 0;
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

      if (body.method === "eth_blockNumber") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x14" }), { status: 200 });
      }

      if (body.method === "eth_call") {
        ethCallCount += 1;

        if (ethCallCount === 1) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
        }

        if (ethCallCount === 2) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount >= 3 && ethCallCount <= 6) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: IncorrectClusterState" } }),
            { status: 200 },
          );
        }

        if (ethCallCount === 7) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x000000000000000000000000000000000000000000000000000000000000001e" }), { status: 200 });
        }

        if (ethCallCount === 8) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount === 9) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount === 10) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
        }

        if (ethCallCount === 11) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
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
                validatorCount: "1",
                networkFeeIndex: "10",
                index: "20",
                active: true,
                balance: "30",
                feeAsset: "ETH",
                effectiveBalance: "64",
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
              operators: [
                { id: "5", fee: "0", feeIndex: "10", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "10", feeIndexBlockNumberSSV: "20" },
                { id: "6", fee: "0", feeIndex: "5", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "5", feeIndexBlockNumberSSV: "20" },
                { id: "7", fee: "0", feeIndex: "3", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "3", feeIndexBlockNumberSSV: "20" },
                { id: "523", fee: "0", feeIndex: "2", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "2", feeIndexBlockNumberSSV: "20" },
              ],
              daovalues: {
                networkFee: "0",
                networkFeeIndex: "10",
                networkFeeIndexBlockNumber: "20",
                liquidationThreshold: "1",
                minimumLiquidationCollateral: "1",
                networkFeeSSV: "0",
                networkFeeIndexSSV: "10",
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

    const result = await verifyClusterIdentity(config, clusterId, { fetchFn });

    expect(result.status).toBe("pass");
    expect(result.checks.find((check) => check.name === "assetType")).toMatchObject({
      status: "pass",
      subgraphValue: "ETH",
      viewsValue: "ETH",
    });
    expect(result.checks.find((check) => check.name === "effectiveBalance")).toMatchObject({
      status: "pass",
      subgraphValue: "64",
    });
    expect(result.checks.find((check) => check.name === "currentBalance")).toMatchObject({
      status: "pass",
      subgraphValue: "30",
      viewsValue: "30",
    });
    expect(result.checks.find((check) => check.name === "burnRate")).toMatchObject({
      status: "pass",
      subgraphValue: "0",
      viewsValue: "0",
    });
    expect(result.checks.find((check) => check.name === "liquidationCollateral")).toMatchObject({
      status: "pass",
      subgraphValue: "1",
      viewsValue: "1",
    });
    expect(result.checks.find((check) => check.name === "liquidatable")).toMatchObject({
      status: "pass",
      subgraphValue: "false",
      viewsValue: "false",
    });
  });

  it("accepts non-divisible ETH effective balance values", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    let ethCallCount = 0;
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

      if (body.method === "eth_blockNumber") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x14" }), { status: 200 });
      }

      if (body.method === "eth_call") {
        ethCallCount += 1;

        if (ethCallCount === 1) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
        }

        if (ethCallCount === 2) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount >= 3 && ethCallCount <= 6) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: IncorrectClusterState" } }),
            { status: 200 },
          );
        }

        if (ethCallCount === 7) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x000000000000000000000000000000000000000000000000000000000000001e" }), { status: 200 });
        }

        if (ethCallCount === 8) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount === 9) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount === 10) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
        }

        if (ethCallCount === 11) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
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
                validatorCount: "1",
                networkFeeIndex: "10",
                index: "20",
                active: true,
                balance: "30",
                feeAsset: "ETH",
                effectiveBalance: "65",
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
              operators: [
                { id: "5", fee: "0", feeIndex: "10", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "10", feeIndexBlockNumberSSV: "20" },
                { id: "6", fee: "0", feeIndex: "5", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "5", feeIndexBlockNumberSSV: "20" },
                { id: "7", fee: "0", feeIndex: "3", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "3", feeIndexBlockNumberSSV: "20" },
                { id: "523", fee: "0", feeIndex: "2", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "2", feeIndexBlockNumberSSV: "20" },
              ],
              daovalues: {
                networkFee: "0",
                networkFeeIndex: "10",
                networkFeeIndexBlockNumber: "20",
                liquidationThreshold: "1",
                minimumLiquidationCollateral: "1",
                networkFeeSSV: "0",
                networkFeeIndexSSV: "10",
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

    const result = await verifyClusterIdentity(config, clusterId, { fetchFn });

    expect(result.status).toBe("pass");
    expect(result.checks.find((check) => check.name === "effectiveBalance")).toMatchObject({
      status: "pass",
      subgraphValue: "65",
    });
    expect(result.checks.find((check) => check.name === "currentBalance")).toMatchObject({
      status: "pass",
    });
  });

  it("blocks derived ETH checks when effective balance is missing", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    let ethCallCount = 0;
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

      if (body.method === "eth_blockNumber") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x14" }), { status: 200 });
      }

      if (body.method === "eth_call") {
        ethCallCount += 1;

        if (ethCallCount === 1) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
        }

        if (ethCallCount === 2) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount >= 3 && ethCallCount <= 6) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: IncorrectClusterState" } }),
            { status: 200 },
          );
        }

        throw new Error(`Unexpected eth_call #${ethCallCount}`);
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
                validatorCount: "1",
                networkFeeIndex: "10",
                index: "20",
                active: true,
                balance: "30",
                feeAsset: "ETH",
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
              operators: [
                { id: "5", fee: "0", feeIndex: "10", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "10", feeIndexBlockNumberSSV: "20" },
                { id: "6", fee: "0", feeIndex: "5", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "5", feeIndexBlockNumberSSV: "20" },
                { id: "7", fee: "0", feeIndex: "3", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "3", feeIndexBlockNumberSSV: "20" },
                { id: "523", fee: "0", feeIndex: "2", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "2", feeIndexBlockNumberSSV: "20" },
              ],
              daovalues: {
                networkFee: "0",
                networkFeeIndex: "10",
                networkFeeIndexBlockNumber: "20",
                liquidationThreshold: "1",
                minimumLiquidationCollateral: "1",
                networkFeeSSV: "0",
                networkFeeIndexSSV: "10",
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

    const result = await verifyClusterIdentity(config, clusterId, { fetchFn });

    expect(result.status).toBe("fail");
    expect(result.checks.find((check) => check.name === "effectiveBalance")).toMatchObject({
      status: "fail",
      subgraphValue: "missing",
    });
    expect(result.checks.find((check) => check.name === "currentBalance")).toMatchObject({
      status: "inconclusive",
      blockedBy: ["effectiveBalance"],
    });
  });

  it("reports an ETH burn rate mismatch", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    let ethCallCount = 0;
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

      if (body.method === "eth_blockNumber") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x14" }), { status: 200 });
      }

      if (body.method === "eth_call") {
        ethCallCount += 1;

        if (ethCallCount === 1) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
        }

        if (ethCallCount === 2) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount >= 3 && ethCallCount <= 6) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: IncorrectClusterState" } }),
            { status: 200 },
          );
        }

        if (ethCallCount === 7) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x000000000000000000000000000000000000000000000000000000000000001e" }), { status: 200 });
        }

        if (ethCallCount === 8) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
        }

        if (ethCallCount === 9) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount === 10) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
        }

        if (ethCallCount === 11) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
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
                validatorCount: "1",
                networkFeeIndex: "10",
                index: "20",
                active: true,
                balance: "30",
                feeAsset: "ETH",
                effectiveBalance: "64",
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
              operators: [
                { id: "5", fee: "0", feeIndex: "10", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "10", feeIndexBlockNumberSSV: "20" },
                { id: "6", fee: "0", feeIndex: "5", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "5", feeIndexBlockNumberSSV: "20" },
                { id: "7", fee: "0", feeIndex: "3", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "3", feeIndexBlockNumberSSV: "20" },
                { id: "523", fee: "0", feeIndex: "2", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "2", feeIndexBlockNumberSSV: "20" },
              ],
              daovalues: {
                networkFee: "0",
                networkFeeIndex: "10",
                networkFeeIndexBlockNumber: "20",
                liquidationThreshold: "1",
                minimumLiquidationCollateral: "1",
                networkFeeSSV: "0",
                networkFeeIndexSSV: "10",
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

    const result = await verifyClusterIdentity(config, clusterId, { fetchFn });

    expect(result.status).toBe("fail");
    expect(result.checks.find((check) => check.name === "currentBalance")).toMatchObject({
      status: "pass",
    });
    expect(result.checks.find((check) => check.name === "burnRate")).toMatchObject({
      status: "fail",
      subgraphValue: "0",
      viewsValue: "1",
    });
  });

  it("reports an ETH liquidation collateral mismatch", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    let ethCallCount = 0;
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

      if (body.method === "eth_blockNumber") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x14" }), { status: 200 });
      }

      if (body.method === "eth_call") {
        ethCallCount += 1;

        if (ethCallCount === 1) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
        }

        if (ethCallCount === 2) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount >= 3 && ethCallCount <= 6) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: IncorrectClusterState" } }),
            { status: 200 },
          );
        }

        if (ethCallCount === 7) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x000000000000000000000000000000000000000000000000000000000000001e" }), { status: 200 });
        }

        if (ethCallCount === 8) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount === 9) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount === 10) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
        }

        if (ethCallCount === 11) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000002" }), { status: 200 });
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
                validatorCount: "1",
                networkFeeIndex: "10",
                index: "20",
                active: true,
                balance: "30",
                feeAsset: "ETH",
                effectiveBalance: "64",
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
              operators: [
                { id: "5", fee: "0", feeIndex: "10", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "10", feeIndexBlockNumberSSV: "20" },
                { id: "6", fee: "0", feeIndex: "5", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "5", feeIndexBlockNumberSSV: "20" },
                { id: "7", fee: "0", feeIndex: "3", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "3", feeIndexBlockNumberSSV: "20" },
                { id: "523", fee: "0", feeIndex: "2", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "2", feeIndexBlockNumberSSV: "20" },
              ],
              daovalues: {
                networkFee: "0",
                networkFeeIndex: "10",
                networkFeeIndexBlockNumber: "20",
                liquidationThreshold: "1",
                minimumLiquidationCollateral: "1",
                networkFeeSSV: "0",
                networkFeeIndexSSV: "10",
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

    const result = await verifyClusterIdentity(config, clusterId, { fetchFn });

    expect(result.status).toBe("fail");
    expect(result.checks.find((check) => check.name === "liquidationCollateral")).toMatchObject({
      status: "fail",
      subgraphValue: "1",
      viewsValue: "2",
    });
    expect(result.checks.find((check) => check.name === "liquidatable")).toMatchObject({
      status: "pass",
      subgraphValue: "false",
      viewsValue: "false",
    });
  });

  it("reports lag as a separate operational check without downgrading mismatches", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    let ethCallCount = 0;
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

      if (body.method === "eth_blockNumber") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x18" }), { status: 200 });
      }

      if (body.method === "eth_call") {
        ethCallCount += 1;

        if (ethCallCount === 1) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount === 2) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }),
            { status: 200 },
          );
        }

        if (ethCallCount >= 3 && ethCallCount <= 6) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: IncorrectClusterState" } }),
            { status: 200 },
          );
        }

        if (ethCallCount === 7) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x000000000000000000000000000000000000000000000000000000000000001d" }), { status: 200 });
        }

        if (ethCallCount === 8) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount === 9) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount === 10) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
        }

        if (ethCallCount === 11) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
        }

        throw new Error(`Unexpected eth_call #${ethCallCount}`);
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
                validatorCount: "1",
                networkFeeIndex: "10",
                index: "20",
                active: true,
                balance: "30",
                feeAsset: "SSV",
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
              operators: [
                { id: "5", fee: "0", feeIndex: "10", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "10", feeIndexBlockNumberSSV: "20" },
                { id: "6", fee: "0", feeIndex: "5", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "5", feeIndexBlockNumberSSV: "20" },
                { id: "7", fee: "0", feeIndex: "3", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "3", feeIndexBlockNumberSSV: "20" },
                { id: "523", fee: "0", feeIndex: "2", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "2", feeIndexBlockNumberSSV: "20" },
              ],
              daovalues: {
                networkFee: "0",
                networkFeeIndex: "10",
                networkFeeIndexBlockNumber: "20",
                liquidationThreshold: "1",
                minimumLiquidationCollateral: "1",
                networkFeeSSV: "0",
                networkFeeIndexSSV: "10",
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

    const result = await verifyClusterIdentity(config, clusterId, { fetchFn });

    expect(result.status).toBe("fail");
    expect(result.freshness).toMatchObject({
      indexedBlockNumber: 20,
      chainHeadBlockNumber: 24,
      lagBlocks: 4,
      status: "lagging",
    });
    expect(result.checks.find((check) => check.name === "currentBalance")).toMatchObject({
      status: "fail",
      classification: "mismatch",
    });
    expect(result.checks.find((check) => check.name === "subgraphLag")).toMatchObject({
      status: "warn",
      classification: "lag-affected",
      subgraphValue: "20",
      viewsValue: "24",
    });
    expect(renderVerifyClusterSummary(result)).toContain("subgraph lag: 4 block(s) (lagging)");
    expect(renderVerifyClusterSummary(result)).toContain("subgraphLag: WARN kind=operational reason=lagging local=20 views=24");
  });

  it("reports a liquidatable mismatch", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    let ethCallCount = 0;
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

      if (body.method === "eth_blockNumber") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x14" }), { status: 200 });
      }

      if (body.method === "eth_call") {
        ethCallCount += 1;

        if (ethCallCount === 1) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount === 2) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }),
            { status: 200 },
          );
        }

        if (ethCallCount >= 3 && ethCallCount <= 6) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: IncorrectClusterState" } }),
            { status: 200 },
          );
        }

        if (ethCallCount === 7) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x000000000000000000000000000000000000000000000000000000000000001e" }), { status: 200 });
        }

        if (ethCallCount === 8) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount === 9) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
        }

        if (ethCallCount === 10) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
        }

        if (ethCallCount === 11) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000001" }), { status: 200 });
        }

        throw new Error(`Unexpected eth_call #${ethCallCount}`);
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
                validatorCount: "1",
                networkFeeIndex: "10",
                index: "20",
                active: true,
                balance: "30",
                feeAsset: "SSV",
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
              operators: [
                { id: "5", fee: "0", feeIndex: "10", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "10", feeIndexBlockNumberSSV: "20" },
                { id: "6", fee: "0", feeIndex: "5", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "5", feeIndexBlockNumberSSV: "20" },
                { id: "7", fee: "0", feeIndex: "3", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "3", feeIndexBlockNumberSSV: "20" },
                { id: "523", fee: "0", feeIndex: "2", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "2", feeIndexBlockNumberSSV: "20" },
              ],
              daovalues: {
                networkFee: "0",
                networkFeeIndex: "10",
                networkFeeIndexBlockNumber: "20",
                liquidationThreshold: "1",
                minimumLiquidationCollateral: "1",
                networkFeeSSV: "0",
                networkFeeIndexSSV: "10",
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

    const result = await verifyClusterIdentity(config, clusterId, { fetchFn });

    expect(result.status).toBe("fail");
    expect(result.checks.find((check) => check.name === "liquidationCollateral")).toMatchObject({
      subgraphValue: "1",
      viewsValue: "1",
      status: "pass",
    });
    expect(result.checks.find((check) => check.name === "liquidatable")).toMatchObject({
      subgraphValue: "false",
      viewsValue: "true",
      status: "fail",
    });
  });

  it("reports when Views rejects the subgraph state", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    let ethCallCount = 0;
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

      if (body.method === "eth_blockNumber") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x14" }), { status: 200 });
      }

      if (body.method === "eth_call") {
        ethCallCount += 1;

        if (ethCallCount === 1) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: ClusterDoesNotExists" } }),
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
                validatorCount: "1",
                networkFeeIndex: "10",
                index: "20",
                active: true,
                balance: "30",
                feeAsset: "SSV",
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
              operators: [
                { id: "5", fee: "0", feeIndex: "10", feeIndexBlockNumber: "20" },
                { id: "6", fee: "0", feeIndex: "5", feeIndexBlockNumber: "20" },
                { id: "7", fee: "0", feeIndex: "3", feeIndexBlockNumber: "20" },
                { id: "523", fee: "0", feeIndex: "2", feeIndexBlockNumber: "20" },
              ],
              daovalues: {
                networkFee: "0",
                networkFeeIndex: "10",
                networkFeeIndexBlockNumber: "20",
                liquidationThreshold: "1",
                minimumLiquidationCollateral: "1",
              },
            },
          }),
          { status: 200 },
        );
      }

      throw new Error(`Unexpected request payload: ${JSON.stringify(body)}`);
    };

    const result = await verifyClusterIdentity(config, clusterId, { fetchFn });

    expect(result.status).toBe("fail");
    expect(result.checks.find((check) => check.name === "assetType")).toMatchObject({
      status: "pass",
      subgraphValue: "SSV",
      viewsValue: "SSV",
    });
    expect(result.checks.find((check) => check.name === "clusterState")).toMatchObject({
      status: "fail",
    });
    expect(result.checks.filter((check) => check.status === "fail")).toHaveLength(1);
    expect(result.checks.filter((check) => check.status === "inconclusive")).toHaveLength(10);
    expect(result.checks).toHaveLength(12);
    expect(renderVerifyClusterSummary(result)).toContain("Views rejected the subgraph cluster state");
  });

  it("marks missing selected-surface operator inputs as operatorData inconclusive and blocks derived checks", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    let ethCallCount = 0;
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

      if (body.method === "eth_blockNumber") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x14" }), { status: 200 });
      }

      if (body.method === "eth_call") {
        ethCallCount += 1;

        if (ethCallCount === 1) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount === 2) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount >= 3 && ethCallCount <= 6) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: IncorrectClusterState" } }),
            { status: 200 },
          );
        }

        throw new Error(`Unexpected eth_call #${ethCallCount}`);
      }

      if (body.query?.includes("cluster(id: $id)")) {
        return new Response(
          JSON.stringify({
            data: {
              _meta: { block: { number: 20 } },
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
              operators: [
                { id: "5", fee: "0", feeIndex: "10", feeIndexBlockNumber: "20" },
                { id: "6", fee: "0", feeIndex: "5", feeIndexBlockNumber: "20" },
                { id: "7", fee: "0", feeIndex: "3", feeIndexBlockNumber: "20" },
                { id: "523", fee: "0", feeIndex: "2", feeIndexBlockNumber: "20" },
              ],
              daovalues: {
                networkFee: "0",
                networkFeeIndex: "10",
                networkFeeIndexBlockNumber: "20",
                liquidationThreshold: "1",
                minimumLiquidationCollateral: "1",
                networkFeeSSV: "0",
                networkFeeIndexSSV: "10",
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

    const result = await verifyClusterIdentity(config, clusterId, { fetchFn });

    expect(result.status).toBe("inconclusive");
    expect(result.checks.find((check) => check.name === "daoData")).toMatchObject({
      status: "pass",
    });
    expect(result.checks.find((check) => check.name === "operatorData")).toMatchObject({
      status: "inconclusive",
      detail: expect.stringContaining("feeSSV"),
    });
    expect(result.checks.find((check) => check.name === "currentBalance")).toMatchObject({
      status: "inconclusive",
      blockedBy: ["operatorData"],
    });
    expect(result.checks.find((check) => check.name === "subgraphLag")).toBeUndefined();
  });

  it("fails daoData when selected-surface DAO inputs are missing and blocks derived checks", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    let ethCallCount = 0;
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

      if (body.method === "eth_blockNumber") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x14" }), { status: 200 });
      }

      if (body.method === "eth_call") {
        ethCallCount += 1;

        if (ethCallCount === 1) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount === 2) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount >= 3 && ethCallCount <= 6) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: IncorrectClusterState" } }),
            { status: 200 },
          );
        }

        throw new Error(`Unexpected eth_call #${ethCallCount}`);
      }

      if (body.query?.includes("cluster(id: $id)")) {
        return new Response(
          JSON.stringify({
            data: {
              _meta: { block: { number: 20 } },
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
              operators: [
                { id: "5", fee: "0", feeIndex: "10", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "10", feeIndexBlockNumberSSV: "20" },
                { id: "6", fee: "0", feeIndex: "5", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "5", feeIndexBlockNumberSSV: "20" },
                { id: "7", fee: "0", feeIndex: "3", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "3", feeIndexBlockNumberSSV: "20" },
                { id: "523", fee: "0", feeIndex: "2", feeIndexBlockNumber: "20", feeSSV: "0", feeIndexSSV: "2", feeIndexBlockNumberSSV: "20" },
              ],
              daovalues: {
                networkFee: "0",
                networkFeeIndex: "10",
                networkFeeIndexBlockNumber: "20",
                liquidationThreshold: "1",
                minimumLiquidationCollateral: "1",
              },
            },
          }),
          { status: 200 },
        );
      }

      throw new Error(`Unexpected request payload: ${JSON.stringify(body)}`);
    };

    const result = await verifyClusterIdentity(config, clusterId, { fetchFn });

    expect(result.status).toBe("fail");
    expect(result.checks.find((check) => check.name === "daoData")).toMatchObject({
      status: "fail",
      detail: expect.stringContaining("networkFeeSSV"),
    });
    expect(result.checks.find((check) => check.name === "operatorData")).toMatchObject({
      status: "pass",
    });
    expect(result.checks.find((check) => check.name === "currentBalance")).toMatchObject({
      status: "inconclusive",
      blockedBy: ["daoData"],
    });
  });

  it("fails clusterState for malformed discovered cluster ids and blocks downstream checks", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    const result = await verifyClusterIdentity(config, "bad-cluster-id", {
      fetchFn: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { method?: string };

        if (body.method === "eth_blockNumber") {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x14" }), { status: 200 });
        }

        throw new Error("unexpected request");
      },
    });

    expect(result.status).toBe("fail");
    expect(result.checks.find((check) => check.name === "clusterState")).toMatchObject({
      status: "fail",
      subgraphValue: "bad-cluster-id",
    });
    expect(result.checks.find((check) => check.name === "assetType")).toMatchObject({
      status: "inconclusive",
      blockedBy: ["clusterState"],
    });
  });

  it("fails clusterState when the pinned cluster snapshot is not found", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    const result = await verifyClusterIdentity(config, clusterId, {
      fetchFn: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

        if (body.method === "eth_blockNumber") {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x14" }), { status: 200 });
        }

        if (body.query?.includes("_meta") && body.query?.includes("cluster(id: $id)")) {
          return new Response(JSON.stringify({ data: { _meta: { block: { number: 20 } }, cluster: null } }), { status: 200 });
        }

        throw new Error(`Unexpected request payload: ${JSON.stringify(body)}`);
      },
    });

    expect(result.status).toBe("fail");
    expect(result.checks.find((check) => check.name === "clusterState")).toMatchObject({
      status: "fail",
      detail: expect.stringContaining("was not found in the subgraph at block 20"),
    });
    expect(result.checks.every((check) => check.name === "clusterState" || check.blockedBy?.includes("clusterState"))).toBe(true);
  });

  it("fails clusterState on fetched owner mismatches before downstream checks run", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    const result = await verifyClusterIdentity(config, clusterId, {
      fetchFn: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

        if (body.method === "eth_blockNumber") {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x14" }), { status: 200 });
        }

        if (body.query?.includes("cluster(id: $id)")) {
          return new Response(
            JSON.stringify({
              data: {
                _meta: { block: { number: 20 } },
                cluster: {
                  id: clusterId,
                  owner: { id: "0x0000000000000000000000000000000000000001" },
                  operatorIds: ["5", "6", "7", "523"],
                  validatorCount: "1",
                  networkFeeIndex: "10",
                  index: "20",
                  active: true,
                  balance: "30",
                  feeAsset: "SSV",
                },
              },
            }),
            { status: 200 },
          );
        }

        if (body.query?.includes("daovalues(id: $daoId)")) {
          return new Response(JSON.stringify({ data: { operators: [], daovalues: null } }), { status: 200 });
        }

        throw new Error(`Unexpected request payload: ${JSON.stringify(body)}`);
      },
    });

    expect(result.status).toBe("fail");
    expect(result.checks.find((check) => check.name === "clusterState")).toMatchObject({
      status: "fail",
      subgraphValue: "0x0000000000000000000000000000000000000001",
      viewsValue: "0xe8c927a1fa792eddefe23fda643a62e03f999830",
    });
    expect(result.checks.find((check) => check.name === "owner")).toMatchObject({
      status: "inconclusive",
      blockedBy: ["clusterState"],
    });
  });
});
