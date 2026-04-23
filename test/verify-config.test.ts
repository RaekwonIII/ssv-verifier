import { Interface } from "ethers";
import { describe, expect, it } from "vitest";

import { renderVerifyNetworkSummary, verifyNetworkConfig } from "../src/commands/verify-network.js";
import { loadRuntimeConfig } from "../src/config/env.js";
import { parseCliArgs } from "../src/index.js";

const baseEnv = {
  MAINNET_RPC_URL: "https://mainnet.example",
  HOODI_RPC_URL: "https://hoodi.example",
  MAINNET_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000001",
  HOODI_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000002",
};

const viewsInterface = new Interface([
  "function getNetworkFee() view returns (uint256 networkFee)",
  "function getLiquidationThresholdPeriod() view returns (uint64 blocks)",
  "function getMinimumLiquidationCollateral() view returns (uint256 amount)",
]);

describe("parseCliArgs verify-network", () => {
  it("parses the verify-network command", () => {
    expect(parseCliArgs(["verify-network", "--network", "hoodi"])).toEqual({
      command: "verify-network",
      network: "hoodi",
      output: "text",
    });
  });
});

describe("verifyNetworkConfig", () => {
  it("reports a successful config comparison flow", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    let ethCallCount = 0;
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

      if (body.method === "eth_call") {
        ethCallCount += 1;

        if (ethCallCount === 1) {
          const result = viewsInterface.encodeFunctionResult("getNetworkFee", [11n]);
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
        }

        if (ethCallCount === 2) {
          const result = viewsInterface.encodeFunctionResult("getLiquidationThresholdPeriod", [12n]);
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
        }

        const result = viewsInterface.encodeFunctionResult("getMinimumLiquidationCollateral", [13n]);
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
      }

      if (body.query?.includes("daovalues(id: $daoId)")) {
        return new Response(JSON.stringify({
          data: {
            daovalues: {
              networkFee: "11",
              liquidationThreshold: "12",
              minimumLiquidationCollateral: "13",
            },
          },
        }), { status: 200 });
      }

      throw new Error(`Unexpected request payload: ${JSON.stringify(body)}`);
    };

    const result = await verifyNetworkConfig(config, { fetchFn });

    expect(result.status).toBe("pass");
    expect(result.checks.every((check) => check.status === "pass")).toBe(true);
    expect(renderVerifyNetworkSummary(result)).toContain("verify-network PASS");
  });

  it("reports a failing config comparison flow", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    let ethCallCount = 0;
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

      if (body.method === "eth_call") {
        ethCallCount += 1;

        if (ethCallCount === 1) {
          const result = viewsInterface.encodeFunctionResult("getNetworkFee", [10n]);
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
        }

        if (ethCallCount === 2) {
          const result = viewsInterface.encodeFunctionResult("getLiquidationThresholdPeriod", [12n]);
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
        }

        const result = viewsInterface.encodeFunctionResult("getMinimumLiquidationCollateral", [99n]);
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
      }

      if (body.query?.includes("daovalues(id: $daoId)")) {
        return new Response(JSON.stringify({
          data: {
            daovalues: {
              networkFee: "11",
              liquidationThreshold: "12",
              minimumLiquidationCollateral: "13",
            },
          },
        }), { status: 200 });
      }

      throw new Error(`Unexpected request payload: ${JSON.stringify(body)}`);
    };

    const result = await verifyNetworkConfig(config, { fetchFn });

    expect(result.status).toBe("fail");
    expect(result.checks.find((check) => check.name === "networkFee")).toMatchObject({
      status: "fail",
      subgraphValue: "11",
      viewsValue: "10",
    });
    expect(result.checks.find((check) => check.name === "minimumLiquidationCollateral")).toMatchObject({
      status: "fail",
      subgraphValue: "13",
      viewsValue: "99",
    });
  });
});
