import { Interface } from "ethers";
import { describe, expect, it } from "vitest";

import viewsAbi from "../src/abi/ssv-network-views.json" with { type: "json" };
import {
  createViewsAdapter,
  getClusterBalanceFromViews,
  getNetworkFeeFromViews,
  getOperatorFeeFromViews,
  type ViewsClusterState,
} from "../src/clients/views.js";

const viewsInterface = new Interface(viewsAbi);
const owner = "0x00000000000000000000000000000000000000aa";
const operatorIds = [1n, 2n, 3n, 4n];
const cluster: ViewsClusterState = {
  validatorCount: 2,
  networkFeeIndex: 10n,
  index: 20n,
  active: true,
  balance: 30n,
};

function createViewsFetchMock() {
  const calledMethods: string[] = [];
  const fetchFn: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { method?: string; params?: Array<{ data?: string }> };

    if (body.method !== "eth_call") {
      throw new Error(`Unexpected JSON-RPC method: ${body.method ?? "unknown"}`);
    }

    const data = body.params?.[0]?.data;

    if (!data) {
      throw new Error("Missing eth_call data payload");
    }

    const transaction = viewsInterface.parseTransaction({ data });

    if (!transaction) {
      throw new Error("Could not decode eth_call payload");
    }

    calledMethods.push(transaction.name);

    const result = (() => {
      switch (transaction.name) {
        case "getBalance":
          return viewsInterface.encodeFunctionResult("getBalance", [111n]);
        case "getBalanceSSV":
          return viewsInterface.encodeFunctionResult("getBalanceSSV", [222n]);
        case "getOperatorFee":
          return viewsInterface.encodeFunctionResult("getOperatorFee", [333n]);
        case "getOperatorFeeSSV":
          return viewsInterface.encodeFunctionResult("getOperatorFeeSSV", [444n]);
        case "getNetworkFee":
          return viewsInterface.encodeFunctionResult("getNetworkFee", [555n]);
        case "getNetworkFeeSSV":
          return viewsInterface.encodeFunctionResult("getNetworkFeeSSV", [666n]);
        default:
          throw new Error(`Unhandled views method ${transaction.name}`);
      }
    })();

    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
  };

  return { fetchFn, calledMethods };
}

describe("createViewsAdapter", () => {
  it("selects ETH or SSV views methods by asset", async () => {
    const { fetchFn, calledMethods } = createViewsFetchMock();
    const adapter = createViewsAdapter("https://hoodi.example", "0x0000000000000000000000000000000000000001", fetchFn);

    await expect(adapter.getClusterBalance("ETH", owner, operatorIds, cluster)).resolves.toBe(111n);
    await expect(adapter.getClusterBalance("SSV", owner, operatorIds, cluster)).resolves.toBe(222n);
    await expect(adapter.getOperatorFee("ETH", 17n)).resolves.toBe(333n);
    await expect(adapter.getOperatorFee("SSV", 17n)).resolves.toBe(444n);
    await expect(adapter.getNetworkFee("ETH")).resolves.toBe(555n);
    await expect(adapter.getNetworkFee("SSV")).resolves.toBe(666n);

    expect(calledMethods).toEqual([
      "getBalance",
      "getBalanceSSV",
      "getOperatorFee",
      "getOperatorFeeSSV",
      "getNetworkFee",
      "getNetworkFeeSSV",
    ]);
  });

  it("keeps the existing legacy helpers on the SSV surface", async () => {
    const { fetchFn, calledMethods } = createViewsFetchMock();

    await expect(getClusterBalanceFromViews("https://hoodi.example", "0x0000000000000000000000000000000000000001", owner, operatorIds, cluster, fetchFn)).resolves.toBe(222n);
    await expect(getOperatorFeeFromViews("https://hoodi.example", "0x0000000000000000000000000000000000000001", 17n, fetchFn)).resolves.toBe(444n);
    await expect(getNetworkFeeFromViews("https://hoodi.example", "0x0000000000000000000000000000000000000001", fetchFn)).resolves.toBe(666n);

    expect(calledMethods).toEqual(["getBalanceSSV", "getOperatorFeeSSV", "getNetworkFeeSSV"]);
  });
});
