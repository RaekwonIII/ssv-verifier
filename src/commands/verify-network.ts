import type { RuntimeConfig } from "../config/env.js";
import type { SingleNetwork } from "../config/networks.js";
import { fetchSubgraphDaoValues } from "../clients/subgraph.js";
import { summarizeStatuses, type CheckStatus } from "../status.js";
import {
  getLiquidationThresholdFromViews,
  getMinimumLiquidationCollateralFromViews,
  getNetworkFeeFromViews,
} from "../clients/views.js";

export interface NetworkCheckResult {
  name: "networkFee" | "liquidationThreshold" | "minimumLiquidationCollateral";
  status: CheckStatus;
  detail: string;
  subgraphValue: string;
  viewsValue: string;
}

export interface VerifyNetworkResult {
  network: SingleNetwork;
  subgraphSource: "primary" | "fallback";
  status: CheckStatus;
  checks: NetworkCheckResult[];
}

export interface VerifyNetworkDependencies {
  fetchFn?: typeof fetch;
}

function summarizeStatus(checks: NetworkCheckResult[]): CheckStatus {
  return summarizeStatuses(checks.map((check) => check.status));
}

export async function verifyNetworkConfig(
  config: RuntimeConfig,
  dependencies: VerifyNetworkDependencies = {},
): Promise<VerifyNetworkResult> {
  if (config.activeNetworks.length !== 1) {
    throw new Error("verify-network requires a single network target, not --network both.");
  }

  const fetchFn = dependencies.fetchFn ?? fetch;
  const network = config.activeNetworks[0]!;
  const networkConfig = config.networks[network];
  const subgraphDaoValues = await fetchSubgraphDaoValues(
    networkConfig.subgraphPrimaryUrl,
    networkConfig.subgraphFallbackUrl,
    networkConfig.daoAddress,
    fetchFn,
  );
  const [viewsNetworkFee, viewsLiquidationThreshold, viewsMinimumCollateral] = await Promise.all([
    getNetworkFeeFromViews(networkConfig.rpcUrl, networkConfig.viewsAddress, fetchFn),
    getLiquidationThresholdFromViews(networkConfig.rpcUrl, networkConfig.viewsAddress, fetchFn),
    getMinimumLiquidationCollateralFromViews(networkConfig.rpcUrl, networkConfig.viewsAddress, fetchFn),
  ]);
  const checks: NetworkCheckResult[] = [
    {
      name: "networkFee",
      status: BigInt(subgraphDaoValues.daoValues.networkFee) === viewsNetworkFee ? "pass" : "fail",
      detail: BigInt(subgraphDaoValues.daoValues.networkFee) === viewsNetworkFee
        ? "Network fee matched Views"
        : "Network fee did not match Views",
      subgraphValue: subgraphDaoValues.daoValues.networkFee,
      viewsValue: viewsNetworkFee.toString(),
    },
    {
      name: "liquidationThreshold",
      status: BigInt(subgraphDaoValues.daoValues.liquidationThreshold) === viewsLiquidationThreshold ? "pass" : "fail",
      detail: BigInt(subgraphDaoValues.daoValues.liquidationThreshold) === viewsLiquidationThreshold
        ? "Liquidation threshold matched Views"
        : "Liquidation threshold did not match Views",
      subgraphValue: subgraphDaoValues.daoValues.liquidationThreshold,
      viewsValue: viewsLiquidationThreshold.toString(),
    },
    {
      name: "minimumLiquidationCollateral",
      status: BigInt(subgraphDaoValues.daoValues.minimumLiquidationCollateral) === viewsMinimumCollateral ? "pass" : "fail",
      detail: BigInt(subgraphDaoValues.daoValues.minimumLiquidationCollateral) === viewsMinimumCollateral
        ? "Minimum liquidation collateral matched Views"
        : "Minimum liquidation collateral did not match Views",
      subgraphValue: subgraphDaoValues.daoValues.minimumLiquidationCollateral,
      viewsValue: viewsMinimumCollateral.toString(),
    },
  ];

  return {
    network,
    subgraphSource: subgraphDaoValues.source,
    status: summarizeStatus(checks),
    checks,
  };
}

export function renderVerifyNetworkSummary(result: VerifyNetworkResult): string {
  const lines = [
    `verify-network ${result.status.toUpperCase()}`,
    `network: ${result.network}`,
    `subgraph source: ${result.subgraphSource}`,
  ];

  for (const check of result.checks) {
    lines.push(`- ${check.name}: ${check.status.toUpperCase()} (subgraph=${check.subgraphValue}; views=${check.viewsValue}; ${check.detail})`);
  }

  return lines.join("\n");
}
