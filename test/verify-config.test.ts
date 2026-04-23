import { Interface } from "ethers";
import { describe, expect, it } from "vitest";

import { renderVerifyNetworkJson, renderVerifyNetworkSummary, verifyNetwork } from "../src/commands/verify-network.js";
import { loadRuntimeConfig } from "../src/config/env.js";

const baseEnv = {
  MAINNET_RPC_URL: "https://mainnet.example",
  HOODI_RPC_URL: "https://hoodi.example",
  MAINNET_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000001",
  HOODI_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000002",
};

const viewsInterface = new Interface([
  "function getNetworkFee() view returns (uint256 networkFee)",
  "function getNetworkFeeSSV() view returns (uint256 networkFee)",
  "function getLiquidationThresholdPeriod() view returns (uint64 blocks)",
  "function getLiquidationThresholdPeriodSSV() view returns (uint64 blocks)",
  "function getMinimumLiquidationCollateral() view returns (uint256 amount)",
  "function getMinimumLiquidationCollateralSSV() view returns (uint256 amount)",
]);

function createViewsFetch(valuesByMethod: Record<string, bigint>): typeof fetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { method?: string; params?: Array<{ data?: string }> };

    if (body.method !== "eth_call") {
      throw new Error(`Unexpected request payload: ${JSON.stringify(body)}`);
    }

    const data = body.params?.[0]?.data;

    if (!data) {
      throw new Error("Missing eth_call data");
    }

    const transaction = viewsInterface.parseTransaction({ data });
    const methodName = transaction?.name;

    if (!methodName || valuesByMethod[methodName] === undefined) {
      throw new Error(`Missing mocked value for ${methodName ?? "unknown method"}`);
    }

    const result = viewsInterface.encodeFunctionResult(methodName, [valuesByMethod[methodName]!]);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
  };
}

describe("verifyNetwork", () => {
  it("reports a successful dual-surface network comparison", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    const result = await verifyNetwork(config, {
      fetchDaoValues: async () => ({
        source: "primary",
        daoValues: {
          networkFee: "11",
          liquidationThreshold: "12",
          minimumLiquidationCollateral: "13",
          networkFeeSSV: "21",
          liquidationThresholdSSV: "22",
          minimumLiquidationCollateralSSV: "23",
        },
      }),
      fetchFn: createViewsFetch({
        getNetworkFee: 11n,
        getLiquidationThresholdPeriod: 12n,
        getMinimumLiquidationCollateral: 13n,
        getNetworkFeeSSV: 21n,
        getLiquidationThresholdPeriodSSV: 22n,
        getMinimumLiquidationCollateralSSV: 23n,
      }),
    });

    expect(result.status).toBe("pass");
    expect(result.networkResults[0]?.assetResults).toMatchObject([
      { asset: "ETH", status: "pass" },
      { asset: "SSV", status: "pass" },
    ]);
    expect(renderVerifyNetworkSummary(result)).toContain("verify-network PASS");
    expect(JSON.parse(renderVerifyNetworkJson(result))).toMatchObject({
      selectedNetwork: "hoodi",
      status: "pass",
    });
  });

  it("reports a failing dual-surface network comparison", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    const result = await verifyNetwork(config, {
      fetchDaoValues: async () => ({
        source: "primary",
        daoValues: {
          networkFee: "11",
          liquidationThreshold: "12",
          minimumLiquidationCollateral: "13",
          networkFeeSSV: "21",
          liquidationThresholdSSV: "22",
          minimumLiquidationCollateralSSV: "23",
        },
      }),
      fetchFn: createViewsFetch({
        getNetworkFee: 10n,
        getLiquidationThresholdPeriod: 12n,
        getMinimumLiquidationCollateral: 13n,
        getNetworkFeeSSV: 21n,
        getLiquidationThresholdPeriodSSV: 22n,
        getMinimumLiquidationCollateralSSV: 99n,
      }),
    });

    expect(result.status).toBe("fail");
    const checks = result.networkResults[0]?.checks ?? [];
    expect(checks.find((check) => check.name === "networkFeeETH")).toMatchObject({
      status: "fail",
      subgraphValue: "11",
      viewsValue: "10",
    });
    expect(checks.find((check) => check.name === "minimumLiquidationCollateralSSV")).toMatchObject({
      status: "fail",
      subgraphValue: "23",
      viewsValue: "99",
    });
  });
});
