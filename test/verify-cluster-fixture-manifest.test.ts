import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  renderVerifyClusterJson,
  renderVerifyClusterSummary,
  toPublicVerifyClusterJson,
  verifyClusterIdentity,
} from "../src/commands/verify-cluster.js";
import { loadRuntimeConfig } from "../src/config/env.js";

const FIXTURE_ROOT = path.join("test", "fixtures", "verify-cluster-mainnet");

const baseEnv = {
  MAINNET_RPC_URL: "https://mainnet.example",
  HOODI_RPC_URL: "https://hoodi.example",
  MAINNET_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000001",
  HOODI_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000002",
};

interface ManifestEntry {
  id: string;
  description: string;
  scenario: "OK" | "falsePositive";
  asset: "ETH";
  network: "mainnet";
  block: number;
  clusterId: string;
  artifacts: { subgraph: string; views: string; expected: string };
}

interface FixtureManifest {
  schemaVersion: number;
  network: "mainnet";
  fixtures: ManifestEntry[];
}

interface SubgraphSnapshot {
  indexedBlockNumber: number;
  cluster: {
    id: string;
    owner: string;
    operatorIds: string[];
    validatorCount: string;
    networkFeeIndex: string;
    index: string;
    active: boolean;
    balance: string;
    feeAsset: "ETH";
    effectiveBalance: string;
  };
  operators: Array<{ id: string; fee: string; feeIndex: string; feeIndexBlockNumber: string }>;
  daoValues: {
    networkFee: string;
    networkFeeIndex: string;
    networkFeeIndexBlockNumber: string;
    liquidationThreshold: string;
    minimumLiquidationCollateral: string;
  };
}

interface ViewsSnapshot {
  blockNumber: number;
  assetType: "ETH";
  reads: {
    getBalance: string;
    getBurnRate: string;
    isLiquidatable: boolean;
    getLiquidationThresholdPeriod: string;
    getMinimumLiquidationCollateral: string;
  };
}

interface ExpectedSnapshot {
  status: "pass";
  scenario: "OK" | "falsePositive";
  clusterId: string;
  verificationBlock: number;
  subgraphSource: "primary";
  checks: Array<{ name: string; status: string }>;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, file), "utf8")) as T;
}

function hexWord(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function encodeUint256(value: bigint): string {
  return `0x${hexWord(value)}`;
}

function encodeBool(value: boolean): string {
  return `0x${hexWord(value ? 1n : 0n)}`;
}

function createFixtureFetch(subgraph: SubgraphSnapshot, views: ViewsSnapshot): typeof fetch {
  let ethCallCount = 0;

  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

    if (body.method === "eth_blockNumber") {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: `0x${views.blockNumber.toString(16)}` }),
        { status: 200 },
      );
    }

    if (body.method === "eth_call") {
      ethCallCount += 1;

      if (ethCallCount === 1) {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeUint256(views.assetType === "ETH" ? 1n : 0n) }),
          { status: 200 },
        );
      }

      if (ethCallCount === 2) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeBool(false) }), { status: 200 });
      }

      if (ethCallCount === 3) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeUint256(BigInt(views.reads.getBalance)) }), { status: 200 });
      }

      if (ethCallCount === 4) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeUint256(BigInt(views.reads.getBurnRate)) }), { status: 200 });
      }

      if (ethCallCount === 5) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeBool(views.reads.isLiquidatable) }), { status: 200 });
      }

      if (ethCallCount === 6) {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeUint256(BigInt(views.reads.getLiquidationThresholdPeriod)) }),
          { status: 200 },
        );
      }

      if (ethCallCount === 7) {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeUint256(BigInt(views.reads.getMinimumLiquidationCollateral)) }),
          { status: 200 },
        );
      }

      throw new Error(`Unexpected eth_call #${ethCallCount}`);
    }

    if (body.query?.includes("_meta")) {
      return new Response(
        JSON.stringify({ data: { _meta: { block: { number: subgraph.indexedBlockNumber } } } }),
        { status: 200 },
      );
    }

    if (body.query?.includes("cluster(id: $id)")) {
      return new Response(
        JSON.stringify({
          data: {
            cluster: {
              ...subgraph.cluster,
              owner: { id: subgraph.cluster.owner },
            },
          },
        }),
        { status: 200 },
      );
    }

    if (body.query?.includes("daovalues(id: $daoId)")) {
      const dao = subgraph.daoValues;
      return new Response(
        JSON.stringify({
          data: {
            operators: subgraph.operators,
            daovalues: {
              ...dao,
              networkFeeSSV: dao.networkFee,
              networkFeeIndexSSV: dao.networkFeeIndex,
              networkFeeIndexBlockNumberSSV: dao.networkFeeIndexBlockNumber,
              liquidationThresholdSSV: dao.liquidationThreshold,
              minimumLiquidationCollateralSSV: dao.minimumLiquidationCollateral,
            },
          },
        }),
        { status: 200 },
      );
    }

    throw new Error(`Unexpected request payload: ${JSON.stringify(body)}`);
  };
}

const manifest = readJson<FixtureManifest>("fixture-manifest.json");

describe("manifest-driven cluster fixture harness", () => {
  it("loads fixtures in manifest order", () => {
    expect(manifest.fixtures.length).toBeGreaterThan(0);
    expect(manifest.fixtures.every((entry) => entry.network === "mainnet")).toBe(true);
  });

  it("covers the report-backed false-positive scenario", () => {
    expect(manifest.fixtures.some((entry) => entry.scenario === "falsePositive")).toBe(true);
  });

  for (const entry of manifest.fixtures) {
    it(`replays ${entry.id} (${entry.scenario}) against the verifier`, async () => {
      const subgraph = readJson<SubgraphSnapshot>(entry.artifacts.subgraph);
      const views = readJson<ViewsSnapshot>(entry.artifacts.views);
      const expected = readJson<ExpectedSnapshot>(entry.artifacts.expected);

      const config = loadRuntimeConfig("mainnet", baseEnv);
      const result = await verifyClusterIdentity(config, entry.clusterId, {
        fetchFn: createFixtureFetch(subgraph, views),
      });

      expect(result.status).toBe(expected.status);
      expect(result.clusterId).toBe(expected.clusterId);
      expect(result.freshness.indexedBlockNumber).toBe(expected.verificationBlock);
      expect(result.checks.every((check) => check.status === "pass")).toBe(true);

      const renderedJson = JSON.parse(renderVerifyClusterJson(result));
      const directJson = toPublicVerifyClusterJson(result);

      expect(renderedJson).toEqual(directJson);
      expect(renderedJson).toMatchObject({
        network: "mainnet",
        clusterId: expected.clusterId,
        subgraphSource: expected.subgraphSource,
        verificationBlock: expected.verificationBlock,
        status: "pass",
      });

      const renderedCheckNames = (renderedJson.checks as Array<{ name: string }>).map((check) => check.name);
      const expectedCheckNames = expected.checks.map((check) => check.name);
      for (const expectedName of expectedCheckNames) {
        expect(renderedCheckNames).toContain(expectedName);
      }

      const summary = renderVerifyClusterSummary(result);
      expect(summary).toContain("verify-cluster PASS");
      expect(summary).toContain(`cluster: ${expected.clusterId}`);
      expect(summary).toContain(`verification block: ${expected.verificationBlock}`);
      expect(summary).not.toContain("accountingDebug");
    });
  }
});
