import { describe, expect, it } from "vitest";

import { loadRuntimeConfig } from "../src/config/env.js";
import { parseCliArgs } from "../src/index.js";
import { renderVerifyNetworkSummary, verifyNetworkHealth } from "../src/commands/verify-network.js";

const baseEnv = {
  MAINNET_RPC_URL: "https://mainnet.example",
  HOODI_RPC_URL: "https://hoodi.example",
  MAINNET_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000001",
  HOODI_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000002",
};

describe("parseCliArgs", () => {
  it("accepts both as a valid network target", () => {
    expect(parseCliArgs(["--network", "both"])).toEqual({ command: "bootstrap", network: "both" });
  });

  it("rejects unsupported network values", () => {
    expect(() => parseCliArgs(["--network", "local"])).toThrow(/Invalid --network value/);
  });

  it("parses the verify-network command", () => {
    expect(parseCliArgs(["verify-network", "--network", "hoodi"])).toEqual({
      command: "verify-network",
      network: "hoodi",
    });
  });
});

describe("loadRuntimeConfig", () => {
  it("expands both into hoodi and mainnet", () => {
    const config = loadRuntimeConfig("both", baseEnv);

    expect(config.activeNetworks).toEqual(["hoodi", "mainnet"]);
    expect(config.networks.hoodi.viewsAddress).toBe("0x0000000000000000000000000000000000000002");
    expect(config.networks.mainnet.viewsAddress).toBe("0x0000000000000000000000000000000000000001");
    expect(config.networks.hoodi.subgraphPrimaryUrl).toMatch(/hoodi/);
    expect(config.networks.mainnet.subgraphPrimaryUrl).toMatch(/ethereum/);
  });
});

describe("verifyNetworkHealth", () => {
  it("reports a successful health check summary", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));

      if (body.method === "eth_blockNumber") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x10" }), { status: 200 });
      }

      if (body.method === "eth_getCode") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1234" }), { status: 200 });
      }

      return new Response(
        JSON.stringify({ data: { _meta: { block: { number: 25 } } } }),
        { status: 200 },
      );
    };

    const results = await verifyNetworkHealth(config, { fetchFn });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ network: "hoodi", status: "pass" });
    expect(renderVerifyNetworkSummary(results)).toContain("verify-network PASS");
  });

  it("reports failures in the summary", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));

      if (body.method === "eth_blockNumber") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x10" }), { status: 200 });
      }

      if (body.method === "eth_getCode") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x" }), { status: 200 });
      }

      return new Response(JSON.stringify({ errors: [{ message: "subgraph down" }] }), { status: 200 });
    };

    const results = await verifyNetworkHealth(config, { fetchFn });

    expect(results[0]?.status).toBe("fail");
    expect(renderVerifyNetworkSummary(results)).toContain("verify-network FAIL");
    expect(renderVerifyNetworkSummary(results)).toContain("subgraph: FAIL");
    expect(renderVerifyNetworkSummary(results)).toContain("views: FAIL");
  });
});
