import { Interface } from "ethers";

import type { RpcClient } from "./rpc-pool.js";
import viewsAbi from "../abi/ssv-network-views.json" with { type: "json" };

const viewsInterface = new Interface(viewsAbi);

export type FeeAsset = "ETH" | "SSV";
const SSV_ASSET_VERSION = 0n;
const ETH_ASSET_VERSION = 1n;

type ClusterMethod = "isLiquidatable" | "getBurnRate" | "getBalance";
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
  feeETH: bigint;
  feeSSV: bigint;
  validatorCount: number;
  active: boolean;
}

async function ethCall(
  rpcClient: RpcClient,
  viewsAddress: string,
  data: string,
  blockTag = "latest",
): Promise<string> {
  return rpcClient.call<string>("eth_call", [
    {
      to: viewsAddress,
      data,
    },
    blockTag,
  ]);
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

export interface ViewsClusterAssetTypeResult {
  status: "success" | "revert";
  asset?: FeeAsset;
  rawVersion?: bigint;
  detail: string;
}

export interface ViewsAdapter {
  validateClusterState(asset: FeeAsset, owner: string, operatorIds: bigint[], cluster: ViewsClusterState): Promise<ViewsValidationResult>;
  getClusterAssetType(owner: string, operatorIds: bigint[], blockTag: string): Promise<ViewsClusterAssetTypeResult>;
  getClusterBalance(asset: FeeAsset, owner: string, operatorIds: bigint[], cluster: ViewsClusterState, blockTag?: string): Promise<bigint>;
  getClusterBurnRate(asset: FeeAsset, owner: string, operatorIds: bigint[], cluster: ViewsClusterState, blockTag?: string): Promise<bigint>;
  getClusterLiquidatable(asset: FeeAsset, owner: string, operatorIds: bigint[], cluster: ViewsClusterState, blockTag?: string): Promise<boolean>;
  getOperatorFee(asset: FeeAsset, operatorId: bigint): Promise<bigint>;
  getOperatorDetails(operatorId: bigint): Promise<ViewsOperatorDetails>;
  getNetworkFee(asset: FeeAsset, blockTag?: string): Promise<bigint>;
  getLiquidationThreshold(asset: FeeAsset, blockTag?: string): Promise<bigint>;
  getMinimumLiquidationCollateral(asset: FeeAsset, blockTag?: string): Promise<bigint>;
}

async function callClusterMethod(
  rpcClient: RpcClient,
  viewsAddress: string,
  asset: FeeAsset,
  methodName: ClusterMethod,
  owner: string,
  operatorIds: bigint[],
  cluster: ViewsClusterState,
  blockTag = "latest",
): Promise<string> {
  const assetAwareMethodName = assetMethodName(asset, methodName) as ClusterMethodName;
  const data = viewsInterface.encodeFunctionData(assetAwareMethodName, [owner, operatorIds, cluster]);

  return ethCall(rpcClient, viewsAddress, data, blockTag);
}

async function callNullaryMethod(
  rpcClient: RpcClient,
  viewsAddress: string,
  asset: FeeAsset,
  methodName: NullaryMethod,
  blockTag = "latest",
): Promise<string> {
  const assetAwareMethodName = assetMethodName(asset, methodName) as NullaryMethodName;
  const data = viewsInterface.encodeFunctionData(assetAwareMethodName, []);

  return ethCall(rpcClient, viewsAddress, data, blockTag);
}

export function createViewsAdapter(
  rpcClient: RpcClient,
  viewsAddress: string,
): ViewsAdapter {
  return {
    async validateClusterState(asset, owner, operatorIds, cluster) {
      const methodName = "isLiquidated";
      const data = viewsInterface.encodeFunctionData(methodName, [owner, operatorIds, cluster]);

      try {
        const response = await ethCall(rpcClient, viewsAddress, data);
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

    async getClusterAssetType(owner, operatorIds, blockTag) {
      const data = viewsInterface.encodeFunctionData("getClusterAssetType", [owner, operatorIds]);

      try {
        const response = await ethCall(rpcClient, viewsAddress, data, blockTag);
        const [rawVersion] = viewsInterface.decodeFunctionResult("getClusterAssetType", response);

        if (rawVersion === ETH_ASSET_VERSION) {
          return {
            status: "success",
            asset: "ETH",
            rawVersion,
            detail: "Views reported ETH cluster accounting",
          };
        }

        if (rawVersion === SSV_ASSET_VERSION) {
          return {
            status: "success",
            asset: "SSV",
            rawVersion,
            detail: "Views reported SSV cluster accounting",
          };
        }

        return {
          status: "success",
          rawVersion,
          detail: `Views returned unsupported cluster asset type ${rawVersion.toString()}`,
        };
      } catch (error) {
        return {
          status: "revert",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async getClusterBalance(asset, owner, operatorIds, cluster, blockTag = "latest") {
      const methodName = assetMethodName(asset, "getBalance") as ClusterMethodName;
      const response = await callClusterMethod(rpcClient, viewsAddress, asset, "getBalance", owner, operatorIds, cluster, blockTag);
      const [balance] = viewsInterface.decodeFunctionResult(methodName, response);

      return balance;
    },

    async getClusterBurnRate(asset, owner, operatorIds, cluster, blockTag = "latest") {
      const methodName = assetMethodName(asset, "getBurnRate") as ClusterMethodName;
      const response = await callClusterMethod(rpcClient, viewsAddress, asset, "getBurnRate", owner, operatorIds, cluster, blockTag);
      const [burnRate] = viewsInterface.decodeFunctionResult(methodName, response);

      return burnRate;
    },

    async getClusterLiquidatable(asset, owner, operatorIds, cluster, blockTag = "latest") {
      const methodName = assetMethodName(asset, "isLiquidatable") as ClusterMethodName;
      const response = await callClusterMethod(rpcClient, viewsAddress, asset, "isLiquidatable", owner, operatorIds, cluster, blockTag);
      const [isLiquidatable] = viewsInterface.decodeFunctionResult(methodName, response);

      return isLiquidatable;
    },

    async getOperatorFee(asset, operatorId) {
      const methodName = assetMethodName(asset, "getOperatorFee") as OperatorFeeMethodName;
      const data = viewsInterface.encodeFunctionData(methodName, [operatorId]);
      const response = await ethCall(rpcClient, viewsAddress, data);
      const [fee] = viewsInterface.decodeFunctionResult(methodName, response);

      return fee;
    },

    async getOperatorDetails(operatorId) {
      const dataEth = viewsInterface.encodeFunctionData("getOperatorById", [operatorId]);
      const dataSsv = viewsInterface.encodeFunctionData("getOperatorByIdSSV", [operatorId]);
      const [responseEth, responseSsv] = await Promise.all([
        ethCall(rpcClient, viewsAddress, dataEth),
        ethCall(rpcClient, viewsAddress, dataSsv),
      ]);
      const [, feeETH, validatorCountEth, , , activeEth] = viewsInterface.decodeFunctionResult("getOperatorById", responseEth);
      const [, feeSSV, validatorCountSsv, , , activeSsv] = viewsInterface.decodeFunctionResult("getOperatorByIdSSV", responseSsv);

      return {
        feeETH,
        feeSSV,
        validatorCount: Number(validatorCountEth) + Number(validatorCountSsv),
        active: Boolean(activeEth) || Boolean(activeSsv),
      };
    },

    async getNetworkFee(asset, blockTag = "latest") {
      const methodName = assetMethodName(asset, "getNetworkFee") as NullaryMethodName;
      const response = await callNullaryMethod(rpcClient, viewsAddress, asset, "getNetworkFee", blockTag);
      const [networkFee] = viewsInterface.decodeFunctionResult(methodName, response);

      return networkFee;
    },

    async getLiquidationThreshold(asset, blockTag = "latest") {
      const methodName = assetMethodName(asset, "getLiquidationThresholdPeriod") as NullaryMethodName;
      const response = await callNullaryMethod(rpcClient, viewsAddress, asset, "getLiquidationThresholdPeriod", blockTag);
      const [threshold] = viewsInterface.decodeFunctionResult(methodName, response);

      return threshold;
    },

    async getMinimumLiquidationCollateral(asset, blockTag = "latest") {
      const methodName = assetMethodName(asset, "getMinimumLiquidationCollateral") as NullaryMethodName;
      const response = await callNullaryMethod(rpcClient, viewsAddress, asset, "getMinimumLiquidationCollateral", blockTag);
      const [minimumCollateral] = viewsInterface.decodeFunctionResult(methodName, response);

      return minimumCollateral;
    },
  };
}
