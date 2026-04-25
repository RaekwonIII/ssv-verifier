import { describe, expect, it } from "vitest";

import { renderVerifyOperatorsSummary, verifyOperators } from "../src/commands/verify-operators.js";
import { loadRuntimeConfig } from "../src/config/env.js";

const baseEnv = {
  MAINNET_RPC_URL: "https://mainnet.example",
  HOODI_RPC_URL: "https://hoodi.example",
  MAINNET_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000001",
  HOODI_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000002",
};

describe("verifyOperators", () => {
  it("aggregates mixed operator results across both networks", async () => {
    const config = loadRuntimeConfig("both", baseEnv);
    const result = await verifyOperators(config, {
      fetchOperatorIds: async (primaryUrl) => ({
        operatorIds: primaryUrl.includes("hoodi") ? ["11"] : ["21", "22"],
        source: "primary",
      }),
      verifyOperator: async (runtimeConfig, operatorId) => {
        if (operatorId === "22") {
          throw new Error("subgraph timeout");
        }

        return {
          network: runtimeConfig.activeNetworks[0]!,
          operatorId,
          subgraphSource: "primary",
          status: operatorId === "11" ? "warn" : "fail",
          checks: operatorId === "11"
            ? [
                {
                  name: "active",
                  status: "warn",
                  detail: "lag-affected",
                  subgraphValue: "true",
                  viewsValue: "true",
                },
              ]
            : [
                {
                  name: "feeSSV",
                  status: "fail",
                  detail: "mismatch",
                  subgraphValue: "30",
                  viewsValue: "31",
                },
              ],
        };
      },
    });

    expect(result).toMatchObject({
      selectedNetwork: "both",
      status: "fail",
      totalOperators: 3,
      totalChecks: 3,
      passedChecks: 0,
      warnedChecks: 1,
      inconclusiveChecks: 1,
      failedChecks: 1,
    });
    expect(renderVerifyOperatorsSummary(result)).toContain("verify-operators FAIL");
    expect(renderVerifyOperatorsSummary(result)).toContain("network selection: both");
    expect(renderVerifyOperatorsSummary(result)).toContain("- hoodi: 0 passed / 1 warned / 0 inconclusive / 0 failed / 1 total");
    expect(renderVerifyOperatorsSummary(result)).toContain("- mainnet: 0 passed / 0 warned / 1 inconclusive / 1 failed / 2 total");
    expect(renderVerifyOperatorsSummary(result)).toContain("hoodi/11: non-passing checks=active:warn");
    expect(renderVerifyOperatorsSummary(result)).toContain("mainnet/21: non-passing checks=feeSSV:fail");
    expect(renderVerifyOperatorsSummary(result)).toContain("mainnet/22: non-passing checks=operator:inconclusive");
  });

  it("supports a single-network operator batch run", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    const result = await verifyOperators(config, {
      fetchOperatorIds: async () => ({
        operatorIds: ["11"],
        source: "fallback",
      }),
      verifyOperator: async () => ({
        network: "hoodi",
        operatorId: "11",
        subgraphSource: "fallback",
        status: "pass",
        checks: [
          {
            name: "feeETH",
            status: "pass",
            detail: "matched",
            subgraphValue: "25",
            viewsValue: "25",
          },
        ],
      }),
    });

    expect(result).toMatchObject({
      selectedNetwork: "hoodi",
      status: "pass",
      totalOperators: 1,
      totalChecks: 1,
      passedChecks: 1,
      warnedChecks: 0,
      inconclusiveChecks: 0,
      failedChecks: 0,
    });
    expect(renderVerifyOperatorsSummary(result)).toContain("source=fallback");
  });
});
