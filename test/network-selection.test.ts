import { Interface } from "ethers";
import { describe, expect, it } from "vitest";

import { renderVerifyNetworkJson, renderVerifyNetworkSummary, verifyNetwork } from "../src/commands/verify-network.js";
import { loadRuntimeConfig } from "../src/config/env.js";
import { renderHealthCheckJson, renderHealthCheckSummary, runHealthCheck } from "../src/commands/health-check.js";
import { parseCliArgs, printHelp } from "../src/index.js";

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

function createViewsFetch(
  valuesByUrl: Record<string, Record<string, bigint>>,
): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as {
      method?: string;
      params?: Array<{ data?: string }>;
    };

    if (body.method !== "eth_call") {
      throw new Error(`Unexpected request payload: ${JSON.stringify(body)}`);
    }

    const callData = body.params?.[0]?.data;

    if (!callData) {
      throw new Error("Missing eth_call data");
    }

    const transaction = viewsInterface.parseTransaction({ data: callData });
    const methodName = transaction?.name;

    if (!methodName) {
      throw new Error(`Unable to decode method from ${callData}`);
    }

    const value = valuesByUrl[url]?.[methodName];

    if (value === undefined) {
      throw new Error(`Missing mocked value for ${url} ${methodName}`);
    }

    const result = viewsInterface.encodeFunctionResult(methodName, [value]);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
  };
}

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

  it("parses verify-network with json output", () => {
    expect(parseCliArgs(["verify-network", "--network", "hoodi", "--output", "json"])).toEqual({
      command: "verify-network",
      network: "hoodi",
      output: "json",
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
    expect(logs.join("\n")).toContain("verify-operators");
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

describe("verifyNetwork", () => {
  it("reports a successful dual-surface verification summary", async () => {
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
        "https://hoodi.example": {
          getNetworkFee: 11n,
          getLiquidationThresholdPeriod: 12n,
          getMinimumLiquidationCollateral: 13n,
          getNetworkFeeSSV: 21n,
          getLiquidationThresholdPeriodSSV: 22n,
          getMinimumLiquidationCollateralSSV: 23n,
        },
      }),
    });

    expect(result.status).toBe("pass");
    expect(result.networkResults[0]?.assetResults).toMatchObject([
      { asset: "ETH", status: "pass" },
      { asset: "SSV", status: "pass" },
    ]);
    expect(renderVerifyNetworkSummary(result)).toContain("verify-network PASS");
    expect(renderVerifyNetworkSummary(result)).toContain("- ETH: PASS");
    expect(renderVerifyNetworkSummary(result)).toContain("- SSV: PASS");
    expect(renderVerifyNetworkJson(result)).toContain('"name": "networkFeeETH"');
    expect(renderVerifyNetworkJson(result)).toContain('"name": "networkFeeSSV"');
  });

  it("reports mixed per-surface verification results across networks", async () => {
    const config = loadRuntimeConfig("both", baseEnv);
    const result = await verifyNetwork(config, {
      fetchDaoValues: async (primaryUrl) => {
        if (primaryUrl.includes("hoodi")) {
          return {
            source: "primary",
            daoValues: {
              networkFee: "11",
              liquidationThreshold: "12",
              minimumLiquidationCollateral: "13",
              networkFeeSSV: "21",
              liquidationThresholdSSV: "22",
              minimumLiquidationCollateralSSV: "23",
            },
          };
        }

        return {
          source: "fallback",
          daoValues: {
            networkFee: "31",
            liquidationThreshold: "32",
            minimumLiquidationCollateral: "33",
            networkFeeSSV: "41",
            liquidationThresholdSSV: "42",
            minimumLiquidationCollateralSSV: "43",
          },
        };
      },
      fetchFn: createViewsFetch({
        "https://hoodi.example": {
          getNetworkFee: 11n,
          getLiquidationThresholdPeriod: 12n,
          getMinimumLiquidationCollateral: 13n,
          getNetworkFeeSSV: 21n,
          getLiquidationThresholdPeriodSSV: 22n,
          getMinimumLiquidationCollateralSSV: 999n,
        },
        "https://mainnet.example": {
          getNetworkFee: 31n,
          getLiquidationThresholdPeriod: 32n,
          getMinimumLiquidationCollateral: 33n,
          getNetworkFeeSSV: 41n,
          getLiquidationThresholdPeriodSSV: 42n,
          getMinimumLiquidationCollateralSSV: 43n,
        },
      }),
    });

    expect(result).toMatchObject({
      selectedNetwork: "both",
      status: "fail",
    });
    expect(result.networkResults).toMatchObject([
      {
        network: "hoodi",
        status: "fail",
        subgraphSource: "primary",
        assetResults: [
          { asset: "ETH", status: "pass" },
          { asset: "SSV", status: "fail" },
        ],
      },
      {
        network: "mainnet",
        status: "pass",
        subgraphSource: "fallback",
      },
    ]);
    expect(renderVerifyNetworkSummary(result)).toContain("network selection: both");
    expect(renderVerifyNetworkSummary(result)).toContain("hoodi: FAIL (source=primary)");
    expect(renderVerifyNetworkSummary(result)).toContain("mainnet: PASS (source=fallback)");
    expect(renderVerifyNetworkSummary(result)).toContain("SSV minimum liquidation collateral did not match Views");
  });
});
