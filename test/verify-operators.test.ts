import { describe, expect, it } from "vitest";

import { renderVerifyOperatorsSummary, verifyOperators } from "../src/commands/verify-operators.js";
import type { ViewsAdapter, ViewsOperatorDetails } from "../src/clients/views.js";
import { loadRuntimeConfig } from "../src/config/env.js";

const baseEnv = {
  MAINNET_RPC_URL: "https://mainnet.example",
  HOODI_RPC_URL: "https://hoodi.example",
  MAINNET_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000001",
  HOODI_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000002",
};

function stubViewsAdapter(getOperatorDetails: (operatorId: bigint) => Promise<ViewsOperatorDetails>): ViewsAdapter {
  const notImplemented = (method: string) => () => {
    throw new Error(`ViewsAdapter.${method} not stubbed`);
  };

  return {
    validateClusterState: notImplemented("validateClusterState") as ViewsAdapter["validateClusterState"],
    getClusterAssetType: notImplemented("getClusterAssetType") as ViewsAdapter["getClusterAssetType"],
    getClusterBalance: notImplemented("getClusterBalance") as ViewsAdapter["getClusterBalance"],
    getClusterBurnRate: notImplemented("getClusterBurnRate") as ViewsAdapter["getClusterBurnRate"],
    getClusterLiquidatable: notImplemented("getClusterLiquidatable") as ViewsAdapter["getClusterLiquidatable"],
    getOperatorFee: notImplemented("getOperatorFee") as ViewsAdapter["getOperatorFee"],
    getOperatorDetails,
    getNetworkFee: notImplemented("getNetworkFee") as ViewsAdapter["getNetworkFee"],
    getLiquidationThreshold: notImplemented("getLiquidationThreshold") as ViewsAdapter["getLiquidationThreshold"],
    getMinimumLiquidationCollateral: notImplemented("getMinimumLiquidationCollateral") as ViewsAdapter["getMinimumLiquidationCollateral"],
  };
}

describe("verifyOperators", () => {
  it("aggregates mixed operator results across both networks without singular operator queries", async () => {
    const config = loadRuntimeConfig("both", baseEnv);
    const subgraphCallUrls: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
      subgraphCallUrls.push(String(input));
      throw new Error("fetchFn should not be invoked when fetchOperatorDetails and createViewsAdapter are stubbed");
    };

    const result = await verifyOperators(config, {
      fetchFn,
      fetchOperatorDetails: async (primaryUrl) => {
        if (primaryUrl.includes("hoodi")) {
          return {
            operators: [
              { id: "11", fee: "10", feeSSV: "20", validatorCount: "5", removed: false },
            ],
            source: "primary",
          };
        }

        return {
          operators: [
            { id: "21", fee: "30", feeSSV: "30", validatorCount: "8", removed: false },
            { id: "22", fee: "40", feeSSV: "40", validatorCount: "9", removed: false },
          ],
          source: "primary",
        };
      },
      createViewsAdapter: (rpcUrls) => stubViewsAdapter(async (operatorId) => {
        const rpcUrl = rpcUrls[0]!;
        if (rpcUrl.includes("hoodi") && operatorId === 11n) {
          return { feeETH: 10n, feeSSV: 20n, validatorCount: 5, active: true };
        }

        if (operatorId === 21n) {
          return { feeETH: 30n, feeSSV: 31n, validatorCount: 8, active: true };
        }

        if (operatorId === 22n) {
          throw new Error("views rpc timeout");
        }

        throw new Error(`unexpected operatorId ${operatorId}`);
      }),
    });

    expect(subgraphCallUrls).toEqual([]);
    expect(result).toMatchObject({
      selectedNetwork: "both",
      status: "fail",
      totalOperators: 3,
      totalChecks: 9,
      passedChecks: 7,
      warnedChecks: 0,
      inconclusiveChecks: 1,
      failedChecks: 1,
    });
    const summary = renderVerifyOperatorsSummary(result);
    expect(summary).toContain("verify-operators FAIL");
    expect(summary).toContain("network selection: both");
    expect(summary).toContain("mainnet/21: non-passing checks=feeSSV:fail");
    expect(summary).toContain("mainnet/22: non-passing checks=operator:inconclusive");
  });

  it("supports a single-network operator batch run with a fallback subgraph source", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    const result = await verifyOperators(config, {
      fetchOperatorDetails: async () => ({
        operators: [
          { id: "11", fee: "25", feeSSV: "25", validatorCount: "3", removed: false },
        ],
        source: "fallback",
      }),
      createViewsAdapter: () => stubViewsAdapter(async () => ({
        feeETH: 25n,
        feeSSV: 25n,
        validatorCount: 3,
        active: true,
      })),
    });

    expect(result).toMatchObject({
      selectedNetwork: "hoodi",
      status: "pass",
      totalOperators: 1,
      totalChecks: 4,
      passedChecks: 4,
      warnedChecks: 0,
      inconclusiveChecks: 0,
      failedChecks: 0,
    });
    expect(renderVerifyOperatorsSummary(result)).toContain("source=fallback");
  });
});
