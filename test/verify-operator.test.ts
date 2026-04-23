import { Interface } from "ethers";
import { describe, expect, it } from "vitest";

import { renderVerifyOperatorJson, renderVerifyOperatorSummary, verifyOperatorState } from "../src/commands/verify-operator.js";
import { loadRuntimeConfig } from "../src/config/env.js";
import { parseCliArgs } from "../src/index.js";

const baseEnv = {
  MAINNET_RPC_URL: "https://mainnet.example",
  HOODI_RPC_URL: "https://hoodi.example",
  MAINNET_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000001",
  HOODI_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000002",
};

const viewsInterface = new Interface([
  "function getOperatorFee(uint64 operatorId) view returns (uint256 fee)",
  "function getOperatorById(uint64 operatorId) view returns (address owner, uint256 fee, uint32 validatorCount, address whitelistedAddress, bool isPrivate, bool active)",
]);

describe("parseCliArgs verify-operator", () => {
  it("parses the verify-operator command", () => {
    expect(parseCliArgs(["verify-operator", "--network", "hoodi", "--operator", "17", "--output", "json"])).toEqual({
      command: "verify-operator",
      network: "hoodi",
      operatorId: "17",
      output: "json",
    });
  });
});

describe("verifyOperatorState", () => {
  it("reports a successful operator comparison flow", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    let ethCallCount = 0;
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

      if (body.method === "eth_call") {
        ethCallCount += 1;

        if (ethCallCount === 1) {
          const result = viewsInterface.encodeFunctionResult("getOperatorFee", [25n]);
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
        }

        const result = viewsInterface.encodeFunctionResult("getOperatorById", [
          "0x00000000000000000000000000000000000000aa",
          25n,
          8,
          "0x00000000000000000000000000000000000000bb",
          false,
          true,
        ]);
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
      }

      if (body.query?.includes("operator(id: $id)")) {
        return new Response(JSON.stringify({
          data: {
            operator: {
              id: "17",
              fee: "25",
              validatorCount: "8",
              active: true,
            },
          },
        }), { status: 200 });
      }

      throw new Error(`Unexpected request payload: ${JSON.stringify(body)}`);
    };

    const result = await verifyOperatorState(config, "17", { fetchFn });

    expect(result.status).toBe("pass");
    expect(result.checks).toEqual([
      expect.objectContaining({ name: "fee", status: "pass", subgraphValue: "25", viewsValue: "25" }),
      expect.objectContaining({ name: "validatorCount", status: "pass", subgraphValue: "8", viewsValue: "8" }),
      expect.objectContaining({ name: "active", status: "pass", subgraphValue: "true", viewsValue: "true" }),
    ]);
    expect(renderVerifyOperatorSummary(result)).toContain("verify-operator PASS");
    expect(JSON.parse(renderVerifyOperatorJson(result))).toMatchObject({
      network: "hoodi",
      operatorId: "17",
      status: "pass",
      checks: [
        { name: "fee", status: "pass" },
        { name: "validatorCount", status: "pass" },
        { name: "active", status: "pass" },
      ],
    });
  });

  it("reports a failing operator comparison flow", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    let ethCallCount = 0;
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

      if (body.method === "eth_call") {
        ethCallCount += 1;

        if (ethCallCount === 1) {
          const result = viewsInterface.encodeFunctionResult("getOperatorFee", [24n]);
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
        }

        const result = viewsInterface.encodeFunctionResult("getOperatorById", [
          "0x00000000000000000000000000000000000000aa",
          24n,
          7,
          "0x00000000000000000000000000000000000000bb",
          false,
          false,
        ]);
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
      }

      if (body.query?.includes("operator(id: $id)")) {
        return new Response(JSON.stringify({
          data: {
            operator: {
              id: "17",
              fee: "25",
              validatorCount: "8",
              active: true,
            },
          },
        }), { status: 200 });
      }

      throw new Error(`Unexpected request payload: ${JSON.stringify(body)}`);
    };

    const result = await verifyOperatorState(config, "17", { fetchFn });

    expect(result.status).toBe("fail");
    expect(result.checks.find((check) => check.name === "fee")).toMatchObject({
      status: "fail",
      subgraphValue: "25",
      viewsValue: "24",
    });
    expect(result.checks.find((check) => check.name === "validatorCount")).toMatchObject({
      status: "fail",
      subgraphValue: "8",
      viewsValue: "7",
    });
    expect(result.checks.find((check) => check.name === "active")).toMatchObject({
      status: "fail",
      subgraphValue: "true",
      viewsValue: "false",
    });
  });
});
