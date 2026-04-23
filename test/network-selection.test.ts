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
  it("defaults to health-check when no command is provided", () => {
    expect(parseCliArgs(["--network", "both"])).toEqual({ command: "health-check", network: "both", output: "text" });
  });

  it("rejects unsupported network values", () => {
    expect(() => parseCliArgs(["--network", "local"])).toThrow(/Invalid --network value/);
  });

  it("parses the health-check command", () => {
    expect(parseCliArgs(["health-check", "--network", "hoodi"])).toEqual({
      command: "health-check",
      network: "hoodi",
      output: "text",
    });
  });

  it("keeps verify-network as an alias to health-check", () => {
    expect(parseCliArgs(["verify-network", "--network", "hoodi"])).toEqual({
      command: "health-check",
      network: "hoodi",
      output: "text",
    });
  });

  it("parses the verify-clusters command", () => {
    expect(parseCliArgs(["verify-clusters", "--network", "hoodi"])).toEqual({
      command: "verify-clusters",
      network: "hoodi",
      output: "text",
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
    expect(renderVerifyNetworkSummary(results)).toContain("health-check PASS");
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
    expect(renderVerifyNetworkSummary(results)).toContain("health-check FAIL");
    expect(renderVerifyNetworkSummary(results)).toContain("subgraph: FAIL");
    expect(renderVerifyNetworkSummary(results)).toContain("views: FAIL");
  });
});
