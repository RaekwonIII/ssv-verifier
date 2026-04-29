import { Interface } from "ethers";
import { describe, expect, it } from "vitest";

import viewsAbi from "../src/abi/ssv-network-views.json" with { type: "json" };
import type { RpcClient } from "../src/clients/rpc-pool.js";
import {
  createViewsAdapter,
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

interface RecordedCall {
  method: string;
  blockTag: string;
}

function createRpcClientMock(): { rpc: RpcClient; recorded: RecordedCall[] } {
  const recorded: RecordedCall[] = [];
  const rpc: RpcClient = {
    async call<T>(method: string, params: unknown[]): Promise<T> {
      if (method !== "eth_call") {
        throw new Error(`Unexpected JSON-RPC method: ${method}`);
      }

      const [{ data }, blockTag] = params as [{ data: string }, string];
      const transaction = viewsInterface.parseTransaction({ data });

      if (!transaction) {
        throw new Error("Could not decode eth_call payload");
      }

      recorded.push({ method: transaction.name, blockTag });

      const result = (() => {
        switch (transaction.name) {
          case "getBalance":
            return viewsInterface.encodeFunctionResult("getBalance", [111n]);
          case "getBalanceSSV":
            return viewsInterface.encodeFunctionResult("getBalanceSSV", [222n]);
          case "getClusterAssetType":
            return viewsInterface.encodeFunctionResult("getClusterAssetType", [1n]);
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

      return result as unknown as T;
    },
  };

  return { rpc, recorded };
}

describe("createViewsAdapter", () => {
  it("selects ETH or SSV views methods by asset", async () => {
    const { rpc, recorded } = createRpcClientMock();
    const adapter = createViewsAdapter(rpc, "0x0000000000000000000000000000000000000001");

    await expect(adapter.getClusterAssetType(owner, operatorIds, "0x7b")).resolves.toMatchObject({
      status: "success",
      asset: "ETH",
      rawVersion: 1n,
    });
    await expect(adapter.getClusterBalance("ETH", owner, operatorIds, cluster, "0x7b")).resolves.toBe(111n);
    await expect(adapter.getClusterBalance("SSV", owner, operatorIds, cluster)).resolves.toBe(222n);
    await expect(adapter.getOperatorFee("ETH", 17n)).resolves.toBe(333n);
    await expect(adapter.getOperatorFee("SSV", 17n)).resolves.toBe(444n);
    await expect(adapter.getNetworkFee("ETH", "0x7b")).resolves.toBe(555n);
    await expect(adapter.getNetworkFee("SSV")).resolves.toBe(666n);

    expect(recorded.map((entry) => entry.method)).toEqual([
      "getClusterAssetType",
      "getBalance",
      "getBalanceSSV",
      "getOperatorFee",
      "getOperatorFeeSSV",
      "getNetworkFee",
      "getNetworkFeeSSV",
    ]);
    expect(recorded.map((entry) => entry.blockTag)).toEqual(["0x7b", "0x7b", "latest", "latest", "latest", "0x7b", "latest"]);
  });
});
