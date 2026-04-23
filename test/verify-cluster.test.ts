import { describe, expect, it } from "vitest";

import {
  deriveClusterBurnRate,
  deriveCurrentClusterBalance,
  deriveLiquidatableStatus,
  deriveLiquidationCollateral,
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
});

describe("verifyClusterIdentity", () => {
  it("derives current cluster balance from subgraph accounting inputs", () => {
    const balance = deriveCurrentClusterBalance(
      {
        feeAsset: "SSV",
        effectiveBalance: null,
        validatorCount: 2,
        networkFeeIndex: 0n,
        index: 0n,
        balance: 500n,
      },
      [
        { fee: 3n, feeIndex: 0n, feeIndexBlockNumber: 100n },
        { fee: 5n, feeIndex: 0n, feeIndexBlockNumber: 100n },
      ],
      {
        networkFee: 7n,
        networkFeeIndex: 0n,
        networkFeeIndexBlockNumber: 100n,
      },
      104n,
    );

    expect(balance).toBe(380n);
  });

  it("derives liquidation values from subgraph accounting inputs", () => {
    const burnRate = deriveClusterBurnRate(
      2,
      [{ fee: 3n }, { fee: 5n }],
      { networkFee: 7n },
    );
    const collateral = deriveLiquidationCollateral(burnRate, {
      liquidationThreshold: 10n,
      minimumLiquidationCollateral: 100n,
    });

    expect(burnRate).toBe(30n);
    expect(collateral).toBe(300n);
    expect(deriveLiquidatableStatus(true, 299n, collateral)).toBe(true);
    expect(deriveLiquidatableStatus(true, 300n, collateral)).toBe(false);
    expect(deriveLiquidatableStatus(false, 0n, collateral)).toBe(false);
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
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: IncorrectClusterState" } }),
            { status: 200 },
          );
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

    expect(result.status).toBe("pass");
    expect(result.freshness).toMatchObject({
      indexedBlockNumber: 20,
      chainHeadBlockNumber: 20,
      lagBlocks: 0,
      status: "fresh",
    });
    expect(result.checks).toHaveLength(9);
    expect(result.checks.find((check) => check.name === "assetType")).toMatchObject({
      subgraphValue: "SSV",
      viewsValue: "SSV",
      status: "pass",
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
    expect(renderVerifyClusterSummary(result)).toContain("verify-cluster PASS");
    expect(JSON.parse(renderVerifyClusterJson(result))).toMatchObject({
      network: "hoodi",
      clusterId,
      status: "pass",
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
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: IncorrectClusterState" } }),
            { status: 200 },
          );
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
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x000000000000000000000000000000000000000000000000000000000000001d" }), { status: 200 });
        }

        if (ethCallCount === 8) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount === 9) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
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
    const balanceCheck = result.checks.find((check) => check.name === "currentBalance");

    expect(result.status).toBe("fail");
    expect(result.freshness.status).toBe("fresh");
    expect(balanceCheck).toMatchObject({
      subgraphValue: "30",
      viewsValue: "29",
      status: "fail",
      classification: "mismatch",
    });
    expect(renderVerifyClusterSummary(result)).toContain("currentBalance: FAIL");
    expect(JSON.parse(renderVerifyClusterJson(result))).toMatchObject({
      network: "hoodi",
      clusterId,
      status: "fail",
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: "currentBalance",
          status: "fail",
          subgraphValue: "30",
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
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
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
      status: "fail",
      subgraphValue: "SSV",
      viewsValue: "ETH",
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
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
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

    expect(result.status).toBe("inconclusive");
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
      status: "inconclusive",
    });
  });

  it("downgrades mismatches to warnings when the subgraph is lagging", async () => {
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
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: IncorrectClusterState" } }),
            { status: 200 },
          );
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
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x000000000000000000000000000000000000000000000000000000000000001d" }), { status: 200 });
        }

        if (ethCallCount === 8) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        if (ethCallCount === 9) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        throw new Error(`Unexpected eth_call #${ethCallCount}`);
      }

      if (body.query?.includes("_meta")) {
        return new Response(JSON.stringify({ data: { _meta: { block: { number: 18 } } } }), { status: 200 });
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

    expect(result.status).toBe("warn");
    expect(result.freshness).toMatchObject({
      indexedBlockNumber: 18,
      chainHeadBlockNumber: 20,
      lagBlocks: 2,
      status: "lagging",
    });
    expect(result.checks.find((check) => check.name === "currentBalance")).toMatchObject({
      status: "warn",
      classification: "lag-affected",
    });
    expect(renderVerifyClusterSummary(result)).toContain("subgraph freshness: lagging");
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
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: IncorrectClusterState" } }),
            { status: 200 },
          );
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
    expect(result.checks.find((check) => check.name === "liquidationCollateral")).toMatchObject({
      subgraphValue: "1",
      viewsValue: "true",
      status: "fail",
    });
    expect(result.checks.find((check) => check.name === "liquidatable")).toMatchObject({
      subgraphValue: "false",
      viewsValue: "true",
      status: "fail",
    });
  });

  it("reports when Views rejects the subgraph state", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

      if (body.method === "eth_blockNumber") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x14" }), { status: 200 });
      }

      if (body.method === "eth_call") {
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
      status: "inconclusive",
      subgraphValue: "SSV",
    });
    expect(result.checks.filter((check) => check.status === "fail")).toHaveLength(8);
    expect(result.checks).toHaveLength(9);
    expect(renderVerifyClusterSummary(result)).toContain("Views rejected the subgraph cluster state");
  });
});
