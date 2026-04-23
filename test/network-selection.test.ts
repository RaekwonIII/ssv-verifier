import { describe, expect, it } from "vitest";

import { loadRuntimeConfig } from "../src/config/env.js";
import { renderHealthCheckJson, runHealthCheck, renderHealthCheckSummary } from "../src/commands/health-check.js";
import { parseCliArgs, printHelp } from "../src/index.js";

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
    expect(parseCliArgs(["health-check", "--network", "hoodi", "--output", "json"])).toEqual({
      command: "health-check",
      network: "hoodi",
      output: "json",
    });
  });

  it("parses verify-network as a distinct command", () => {
    expect(parseCliArgs(["verify-network", "--network", "hoodi"])).toEqual({
      command: "verify-network",
      network: "hoodi",
      output: "text",
    });
  });

  it("rejects the removed verify-config command", () => {
    expect(() => parseCliArgs(["verify-config", "--network", "hoodi"])).toThrow(/Unknown argument/);
  });

  it("parses the verify-clusters command", () => {
    expect(parseCliArgs(["verify-clusters", "--network", "hoodi"])).toEqual({
      command: "verify-clusters",
      network: "hoodi",
      output: "text",
    });
  });

  it("parses the verify-operators command", () => {
    expect(parseCliArgs(["verify-operators", "--network", "both"])).toEqual({
      command: "verify-operators",
      network: "both",
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

describe("printHelp", () => {
  it("shows the stable network command surface", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => {
      logs.push(String(message ?? ""));
    };

    try {
      printHelp();
    } finally {
      console.log = originalLog;
    }

    expect(logs.join("\n")).toContain("health-check");
    expect(logs.join("\n")).toContain("verify-network");
    expect(logs.join("\n")).not.toContain("verify-config");
  });
});

describe("runHealthCheck", () => {
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

    const results = await runHealthCheck(config, { fetchFn });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ network: "hoodi", status: "pass" });
    expect(renderHealthCheckSummary(results)).toContain("health-check PASS");
    expect(JSON.parse(renderHealthCheckJson("hoodi", results))).toMatchObject({
      selectedNetwork: "hoodi",
      status: "pass",
      networkResults: [
        {
          network: "hoodi",
          status: "pass",
        },
      ],
    });
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

    const results = await runHealthCheck(config, { fetchFn });

    expect(results[0]?.status).toBe("fail");
    expect(renderHealthCheckSummary(results)).toContain("health-check FAIL");
    expect(renderHealthCheckSummary(results)).toContain("subgraph: FAIL");
    expect(renderHealthCheckSummary(results)).toContain("views: FAIL");
  });
});
