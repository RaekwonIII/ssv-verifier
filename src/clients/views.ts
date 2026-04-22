import { Interface } from "ethers";

import { jsonRpcRequest } from "./json-rpc.js";

const viewsInterface = new Interface([
  "function isLiquidatable(address clusterOwner, uint64[] operatorIds, (uint32 validatorCount, uint64 networkFeeIndex, uint64 index, bool active, uint256 balance) cluster) view returns (bool)",
  "function isLiquidated(address clusterOwner, uint64[] operatorIds, (uint32 validatorCount, uint64 networkFeeIndex, uint64 index, bool active, uint256 balance) cluster) view returns (bool)",
  "function getBurnRate(address clusterOwner, uint64[] operatorIds, (uint32 validatorCount, uint64 networkFeeIndex, uint64 index, bool active, uint256 balance) cluster) view returns (uint256)",
  "function getBalance(address clusterOwner, uint64[] operatorIds, (uint32 validatorCount, uint64 networkFeeIndex, uint64 index, bool active, uint256 balance) cluster) view returns (uint256)",
  "function getOperatorFee(uint64 operatorId) view returns (uint256 fee)",
  "function getOperatorById(uint64 operatorId) view returns (address owner, uint256 fee, uint32 validatorCount, address whitelistedAddress, bool isPrivate, bool active)",
  "function getNetworkFee() view returns (uint256 networkFee)",
  "function getLiquidationThresholdPeriod() view returns (uint64 blocks)",
  "function getMinimumLiquidationCollateral() view returns (uint256 amount)",
]);

export interface ViewsOperatorDetails {
  fee: bigint;
  validatorCount: number;
  active: boolean;
}

async function ethCall(
  rpcUrl: string,
  viewsAddress: string,
  data: string,
  fetchFn: typeof fetch,
): Promise<string> {
  return jsonRpcRequest<string>(
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
}

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
  const response = await ethCall(rpcUrl, viewsAddress, data, fetchFn);
  const [balance] = viewsInterface.decodeFunctionResult("getBalance", response);

  return balance;
}

export async function getClusterBurnRateFromViews(
  rpcUrl: string,
  viewsAddress: string,
  owner: string,
  operatorIds: bigint[],
  cluster: ViewsClusterState,
  fetchFn: typeof fetch = fetch,
): Promise<bigint> {
  const data = viewsInterface.encodeFunctionData("getBurnRate", [owner, operatorIds, cluster]);
  const response = await ethCall(rpcUrl, viewsAddress, data, fetchFn);
  const [burnRate] = viewsInterface.decodeFunctionResult("getBurnRate", response);

  return burnRate;
}

export async function getClusterLiquidatableFromViews(
  rpcUrl: string,
  viewsAddress: string,
  owner: string,
  operatorIds: bigint[],
  cluster: ViewsClusterState,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  const data = viewsInterface.encodeFunctionData("isLiquidatable", [owner, operatorIds, cluster]);
  const response = await ethCall(rpcUrl, viewsAddress, data, fetchFn);
  const [isLiquidatable] = viewsInterface.decodeFunctionResult("isLiquidatable", response);

  return isLiquidatable;
}

export async function getOperatorFeeFromViews(
  rpcUrl: string,
  viewsAddress: string,
  operatorId: bigint,
  fetchFn: typeof fetch = fetch,
): Promise<bigint> {
  const data = viewsInterface.encodeFunctionData("getOperatorFee", [operatorId]);
  const response = await ethCall(rpcUrl, viewsAddress, data, fetchFn);
  const [fee] = viewsInterface.decodeFunctionResult("getOperatorFee", response);

  return fee;
}

export async function getOperatorDetailsFromViews(
  rpcUrl: string,
  viewsAddress: string,
  operatorId: bigint,
  fetchFn: typeof fetch = fetch,
): Promise<ViewsOperatorDetails> {
  const data = viewsInterface.encodeFunctionData("getOperatorById", [operatorId]);
  const response = await ethCall(rpcUrl, viewsAddress, data, fetchFn);
  const [, fee, validatorCount, , , active] = viewsInterface.decodeFunctionResult("getOperatorById", response);

  return {
    fee,
    validatorCount: Number(validatorCount),
    active: Boolean(active),
  };
}

export async function getNetworkFeeFromViews(
  rpcUrl: string,
  viewsAddress: string,
  fetchFn: typeof fetch = fetch,
): Promise<bigint> {
  const data = viewsInterface.encodeFunctionData("getNetworkFee", []);
  const response = await ethCall(rpcUrl, viewsAddress, data, fetchFn);
  const [networkFee] = viewsInterface.decodeFunctionResult("getNetworkFee", response);

  return networkFee;
}

export async function getLiquidationThresholdFromViews(
  rpcUrl: string,
  viewsAddress: string,
  fetchFn: typeof fetch = fetch,
): Promise<bigint> {
  const data = viewsInterface.encodeFunctionData("getLiquidationThresholdPeriod", []);
  const response = await ethCall(rpcUrl, viewsAddress, data, fetchFn);
  const [threshold] = viewsInterface.decodeFunctionResult("getLiquidationThresholdPeriod", response);

  return threshold;
}

export async function getMinimumLiquidationCollateralFromViews(
  rpcUrl: string,
  viewsAddress: string,
  fetchFn: typeof fetch = fetch,
): Promise<bigint> {
  const data = viewsInterface.encodeFunctionData("getMinimumLiquidationCollateral", []);
  const response = await ethCall(rpcUrl, viewsAddress, data, fetchFn);
  const [minimumCollateral] = viewsInterface.decodeFunctionResult("getMinimumLiquidationCollateral", response);

  return minimumCollateral;
}
