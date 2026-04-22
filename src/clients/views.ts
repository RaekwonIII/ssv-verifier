import { Interface } from "ethers";

import { jsonRpcRequest } from "./json-rpc.js";

const viewsInterface = new Interface([
  "function isLiquidated(address clusterOwner, uint64[] operatorIds, (uint32 validatorCount, uint64 networkFeeIndex, uint64 index, bool active, uint256 balance) cluster) view returns (bool)",
  "function getBalance(address clusterOwner, uint64[] operatorIds, (uint32 validatorCount, uint64 networkFeeIndex, uint64 index, bool active, uint256 balance) cluster) view returns (uint256)",
]);

export interface ViewsClusterState {
  validatorCount: number;
  networkFeeIndex: bigint;
  index: bigint;
  active: boolean;
  balance: bigint;
}

export interface ViewsValidationResult {
  status: "success" | "revert";
  isLiquidated?: boolean;
  detail: string;
}

export async function validateClusterStateWithViews(
  rpcUrl: string,
  viewsAddress: string,
  owner: string,
  operatorIds: bigint[],
  cluster: ViewsClusterState,
  fetchFn: typeof fetch = fetch,
): Promise<ViewsValidationResult> {
  const data = viewsInterface.encodeFunctionData("isLiquidated", [owner, operatorIds, cluster]);

  try {
    const response = await jsonRpcRequest<string>(
      rpcUrl,
      "eth_call",
      [
        {
          to: viewsAddress,
          data,
        },
        "latest",
      ],
      fetchFn,
    );

    const [isLiquidated] = viewsInterface.decodeFunctionResult("isLiquidated", response);

    return {
      status: "success",
      isLiquidated,
      detail: `Views accepted the supplied cluster state (liquidated=${String(isLiquidated)})`,
    };
  } catch (error) {
    return {
      status: "revert",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getClusterBalanceFromViews(
  rpcUrl: string,
  viewsAddress: string,
  owner: string,
  operatorIds: bigint[],
  cluster: ViewsClusterState,
  fetchFn: typeof fetch = fetch,
): Promise<bigint> {
  const data = viewsInterface.encodeFunctionData("getBalance", [owner, operatorIds, cluster]);
  const response = await jsonRpcRequest<string>(
    rpcUrl,
    "eth_call",
    [
      {
        to: viewsAddress,
        data,
      },
      "latest",
    ],
    fetchFn,
  );
  const [balance] = viewsInterface.decodeFunctionResult("getBalance", response);

  return balance;
}
