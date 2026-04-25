import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { verifyClusterIdentity } from "../src/commands/verify-cluster.js";
import { loadRuntimeConfig } from "../src/config/env.js";

const baseEnv = {
  MAINNET_RPC_URL: "https://mainnet.example",
  HOODI_RPC_URL: "https://hoodi.example",
  MAINNET_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000001",
  HOODI_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000002",
};

interface ClusterFixture {
  clusterId: string;
  rpcBlockNumber: number;
  subgraphMetaBlockNumber: number;
  cluster: {
    id: string;
    owner: { id: string };
    operatorIds: string[];
    validatorCount: string;
    networkFeeIndex: string;
    index: string;
    active: boolean;
    balance: string;
    feeAsset: "ETH" | "SSV";
  };
  operators: Array<{
    id: string;
    fee: string;
    feeIndex: string;
    feeIndexBlockNumber: string;
  }>;
  daoValues: {
    networkFee: string;
    networkFeeIndex: string;
    networkFeeIndexBlockNumber: string;
    liquidationThreshold: string;
    minimumLiquidationCollateral: string;
  };
  views: {
    baseline: "success" | "revert";
    balance: string;
    burnRate: string;
    liquidatable: boolean;
  };
  expected: {
    status: "pass" | "warn" | "fail";
    freshnessStatus: "fresh" | "lagging";
    failingChecks: string[];
  };
}

function loadFixture(name: string): ClusterFixture {
  const filePath = path.join(process.cwd(), "test", "fixtures", "verify-cluster", `${name}.json`);
  return JSON.parse(readFileSync(filePath, "utf8")) as ClusterFixture;
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

function createFixtureFetch(fixture: ClusterFixture): typeof fetch {
  let ethCallCount = 0;

  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

    if (body.method === "eth_blockNumber") {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: `0x${fixture.rpcBlockNumber.toString(16)}` }),
        { status: 200 },
      );
    }

      if (body.method === "eth_call") {
        ethCallCount += 1;

        if (ethCallCount === 1) {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: encodeUint256(fixture.cluster.feeAsset === "ETH" ? 1n : 0n),
            }),
            { status: 200 },
          );
        }

        if (fixture.views.baseline === "revert" && ethCallCount === 2) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: IncorrectClusterState" } }),
            { status: 200 },
          );
        }

        if (ethCallCount === 2) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeBool(false) }), { status: 200 });
        }

        if (ethCallCount >= 3 && ethCallCount <= 6) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: IncorrectClusterState" } }),
            { status: 200 },
          );
        }

        if (ethCallCount === 7) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeUint256(BigInt(fixture.views.balance)) }),
            { status: 200 },
          );
        }

        if (ethCallCount === 8) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeUint256(BigInt(fixture.views.burnRate)) }),
            { status: 200 },
          );
        }

        if (ethCallCount === 9) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeBool(fixture.views.liquidatable) }),
            { status: 200 },
          );
        }

        if (ethCallCount === 10) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeUint256(BigInt(fixture.daoValues.liquidationThreshold)) }),
            { status: 200 },
          );
        }

        if (ethCallCount === 11) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeUint256(BigInt(fixture.daoValues.minimumLiquidationCollateral)) }),
            { status: 200 },
          );
        }

        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: IncorrectClusterState" } }),
          { status: 200 },
        );
      }

    if (body.query?.includes("_meta")) {
      return new Response(JSON.stringify({ data: { _meta: { block: { number: fixture.subgraphMetaBlockNumber } } } }), { status: 200 });
    }

    if (body.query?.includes("cluster(id: $id)")) {
      return new Response(JSON.stringify({ data: { cluster: fixture.cluster } }), { status: 200 });
    }

    if (body.query?.includes("daovalues(id: $daoId)")) {
      return new Response(JSON.stringify({
        data: {
          operators: fixture.operators,
          daovalues: fixture.daoValues,
        },
      }), { status: 200 });
    }

    throw new Error(`Unexpected request payload: ${JSON.stringify(body)}`);
  };
}

describe("verifyClusterIdentity fixture regressions", () => {
  for (const fixtureName of ["pass", "fail"]) {
    it(`matches the ${fixtureName} fixture expectation`, async () => {
      const fixture = loadFixture(fixtureName);
      const config = loadRuntimeConfig("hoodi", baseEnv);
      const result = await verifyClusterIdentity(config, fixture.clusterId, {
        fetchFn: createFixtureFetch(fixture),
      });

      expect(result.status).toBe(fixture.expected.status);
      expect(result.freshness.status).toBe(fixture.expected.freshnessStatus);
      expect(
        result.checks.filter((check) => check.status !== "pass").map((check) => check.name),
      ).toEqual(fixture.expected.failingChecks);
    });
  }
});
