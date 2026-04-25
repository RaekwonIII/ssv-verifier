import { Interface } from "ethers";

import { jsonRpcRequest } from "./json-rpc.js";
import viewsAbi from "../abi/ssv-network-views.json" with { type: "json" };

const viewsInterface = new Interface(viewsAbi);

export type FeeAsset = "ETH" | "SSV";

type ClusterMethod = "isLiquidatable" | "isLiquidated" | "getBurnRate" | "getBalance";
type ClusterMethodName = ClusterMethod | `${ClusterMethod}SSV`;
type NullaryMethod = "getNetworkFee" | "getLiquidationThresholdPeriod" | "getMinimumLiquidationCollateral";
type NullaryMethodName = NullaryMethod | `${NullaryMethod}SSV`;
type OperatorFeeMethodName = "getOperatorFee" | "getOperatorFeeSSV";

function assetMethodName<T extends ClusterMethod | NullaryMethod | "getOperatorFee">(
  asset: FeeAsset,
  methodName: T,
): T | `${T}SSV` {
  if (asset === "ETH") {
    return methodName;
  }

  return `${methodName}SSV`;
}

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

export interface ViewsAdapter {
  validateClusterState(asset: FeeAsset, owner: string, operatorIds: bigint[], cluster: ViewsClusterState): Promise<ViewsValidationResult>;
  getClusterBalance(asset: FeeAsset, owner: string, operatorIds: bigint[], cluster: ViewsClusterState): Promise<bigint>;
  getClusterBurnRate(asset: FeeAsset, owner: string, operatorIds: bigint[], cluster: ViewsClusterState): Promise<bigint>;
  getClusterLiquidatable(asset: FeeAsset, owner: string, operatorIds: bigint[], cluster: ViewsClusterState): Promise<boolean>;
  getOperatorFee(asset: FeeAsset, operatorId: bigint): Promise<bigint>;
  getOperatorDetails(operatorId: bigint): Promise<ViewsOperatorDetails>;
  getNetworkFee(asset: FeeAsset): Promise<bigint>;
  getLiquidationThreshold(asset: FeeAsset): Promise<bigint>;
  getMinimumLiquidationCollateral(asset: FeeAsset): Promise<bigint>;
}

async function callClusterMethod(
  rpcUrl: string,
  viewsAddress: string,
  asset: FeeAsset,
  methodName: ClusterMethod,
  owner: string,
  operatorIds: bigint[],
  cluster: ViewsClusterState,
  fetchFn: typeof fetch,
): Promise<string> {
  const assetAwareMethodName = assetMethodName(asset, methodName) as ClusterMethodName;
  const data = viewsInterface.encodeFunctionData(assetAwareMethodName, [owner, operatorIds, cluster]);

  return ethCall(rpcUrl, viewsAddress, data, fetchFn);
}

async function callNullaryMethod(
  rpcUrl: string,
  viewsAddress: string,
  asset: FeeAsset,
  methodName: NullaryMethod,
  fetchFn: typeof fetch,
): Promise<string> {
  const assetAwareMethodName = assetMethodName(asset, methodName) as NullaryMethodName;
  const data = viewsInterface.encodeFunctionData(assetAwareMethodName, []);

  return ethCall(rpcUrl, viewsAddress, data, fetchFn);
}

export function createViewsAdapter(
  rpcUrl: string,
  viewsAddress: string,
  fetchFn: typeof fetch = fetch,
): ViewsAdapter {
  return {
    async validateClusterState(asset, owner, operatorIds, cluster) {
      const methodName = assetMethodName(asset, "isLiquidated") as ClusterMethodName;
      const data = viewsInterface.encodeFunctionData(methodName, [owner, operatorIds, cluster]);

      try {
        const response = await ethCall(rpcUrl, viewsAddress, data, fetchFn);
        const [isLiquidated] = viewsInterface.decodeFunctionResult(methodName, response);

        return {
          status: "success",
          isLiquidated,
          detail: `Views accepted the supplied ${asset} cluster state (liquidated=${String(isLiquidated)})`,
        };
      } catch (error) {
        return {
          status: "revert",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async getClusterBalance(asset, owner, operatorIds, cluster) {
      const methodName = assetMethodName(asset, "getBalance") as ClusterMethodName;
      const response = await callClusterMethod(rpcUrl, viewsAddress, asset, "getBalance", owner, operatorIds, cluster, fetchFn);
      const [balance] = viewsInterface.decodeFunctionResult(methodName, response);

      return balance;
    },

    async getClusterBurnRate(asset, owner, operatorIds, cluster) {
      const methodName = assetMethodName(asset, "getBurnRate") as ClusterMethodName;
      const response = await callClusterMethod(rpcUrl, viewsAddress, asset, "getBurnRate", owner, operatorIds, cluster, fetchFn);
      const [burnRate] = viewsInterface.decodeFunctionResult(methodName, response);

      return burnRate;
    },

    async getClusterLiquidatable(asset, owner, operatorIds, cluster) {
      const methodName = assetMethodName(asset, "isLiquidatable") as ClusterMethodName;
      const response = await callClusterMethod(rpcUrl, viewsAddress, asset, "isLiquidatable", owner, operatorIds, cluster, fetchFn);
      const [isLiquidatable] = viewsInterface.decodeFunctionResult(methodName, response);

      return isLiquidatable;
    },

    async getOperatorFee(asset, operatorId) {
      const methodName = assetMethodName(asset, "getOperatorFee") as OperatorFeeMethodName;
      const data = viewsInterface.encodeFunctionData(methodName, [operatorId]);
      const response = await ethCall(rpcUrl, viewsAddress, data, fetchFn);
      const [fee] = viewsInterface.decodeFunctionResult(methodName, response);

      return fee;
    },

    async getOperatorDetails(operatorId) {
      const data = viewsInterface.encodeFunctionData("getOperatorById", [operatorId]);
      const response = await ethCall(rpcUrl, viewsAddress, data, fetchFn);
      const [, fee, validatorCount, , , active] = viewsInterface.decodeFunctionResult("getOperatorById", response);

      return {
        fee,
        validatorCount: Number(validatorCount),
        active: Boolean(active),
      };
    },

    async getNetworkFee(asset) {
      const methodName = assetMethodName(asset, "getNetworkFee") as NullaryMethodName;
      const response = await callNullaryMethod(rpcUrl, viewsAddress, asset, "getNetworkFee", fetchFn);
      const [networkFee] = viewsInterface.decodeFunctionResult(methodName, response);

      return networkFee;
    },

    async getLiquidationThreshold(asset) {
      const methodName = assetMethodName(asset, "getLiquidationThresholdPeriod") as NullaryMethodName;
      const response = await callNullaryMethod(rpcUrl, viewsAddress, asset, "getLiquidationThresholdPeriod", fetchFn);
      const [threshold] = viewsInterface.decodeFunctionResult(methodName, response);

      return threshold;
    },

    async getMinimumLiquidationCollateral(asset) {
      const methodName = assetMethodName(asset, "getMinimumLiquidationCollateral") as NullaryMethodName;
      const response = await callNullaryMethod(rpcUrl, viewsAddress, asset, "getMinimumLiquidationCollateral", fetchFn);
      const [minimumCollateral] = viewsInterface.decodeFunctionResult(methodName, response);

      return minimumCollateral;
    },
  };
}

export async function validateClusterStateWithViews(
  rpcUrl: string,
  viewsAddress: string,
  owner: string,
  operatorIds: bigint[],
  cluster: ViewsClusterState,
  fetchFn: typeof fetch = fetch,
): Promise<ViewsValidationResult> {
  return createViewsAdapter(rpcUrl, viewsAddress, fetchFn).validateClusterState("SSV", owner, operatorIds, cluster);
}

export async function getClusterBalanceFromViews(
  rpcUrl: string,
  viewsAddress: string,
  owner: string,
  operatorIds: bigint[],
  cluster: ViewsClusterState,
  fetchFn: typeof fetch = fetch,
): Promise<bigint> {
  return createViewsAdapter(rpcUrl, viewsAddress, fetchFn).getClusterBalance("SSV", owner, operatorIds, cluster);
}

export async function getClusterBurnRateFromViews(
  rpcUrl: string,
  viewsAddress: string,
  owner: string,
  operatorIds: bigint[],
  cluster: ViewsClusterState,
  fetchFn: typeof fetch = fetch,
): Promise<bigint> {
  return createViewsAdapter(rpcUrl, viewsAddress, fetchFn).getClusterBurnRate("SSV", owner, operatorIds, cluster);
}

export async function getClusterLiquidatableFromViews(
  rpcUrl: string,
  viewsAddress: string,
  owner: string,
  operatorIds: bigint[],
  cluster: ViewsClusterState,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  return createViewsAdapter(rpcUrl, viewsAddress, fetchFn).getClusterLiquidatable("SSV", owner, operatorIds, cluster);
}

export async function getOperatorFeeFromViews(
  rpcUrl: string,
  viewsAddress: string,
  operatorId: bigint,
  fetchFn: typeof fetch = fetch,
): Promise<bigint> {
  return createViewsAdapter(rpcUrl, viewsAddress, fetchFn).getOperatorFee("SSV", operatorId);
}

export async function getOperatorDetailsFromViews(
  rpcUrl: string,
  viewsAddress: string,
  operatorId: bigint,
  fetchFn: typeof fetch = fetch,
): Promise<ViewsOperatorDetails> {
  return createViewsAdapter(rpcUrl, viewsAddress, fetchFn).getOperatorDetails(operatorId);
}

export async function getNetworkFeeFromViews(
  rpcUrl: string,
  viewsAddress: string,
  fetchFn: typeof fetch = fetch,
): Promise<bigint> {
  return createViewsAdapter(rpcUrl, viewsAddress, fetchFn).getNetworkFee("SSV");
}

export async function getLiquidationThresholdFromViews(
  rpcUrl: string,
  viewsAddress: string,
  fetchFn: typeof fetch = fetch,
): Promise<bigint> {
  return createViewsAdapter(rpcUrl, viewsAddress, fetchFn).getLiquidationThreshold("SSV");
}

export async function getMinimumLiquidationCollateralFromViews(
  rpcUrl: string,
  viewsAddress: string,
  fetchFn: typeof fetch = fetch,
): Promise<bigint> {
  return createViewsAdapter(rpcUrl, viewsAddress, fetchFn).getMinimumLiquidationCollateral("SSV");
}
