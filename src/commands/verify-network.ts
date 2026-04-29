import type { RuntimeConfig } from "../config/env.js";
import type { SingleNetwork } from "../config/networks.js";
import type { Bar, ProgressReporter } from "../ui/progress.js";
import { createNetworkRpcPool, type RpcClient } from "../clients/rpc-pool.js";
import { fetchSubgraphDaoValues } from "../clients/subgraph.js";
import { createViewsAdapter, type FeeAsset } from "../clients/views.js";
import { summarizeStatuses, type CheckStatus } from "../status.js";

type VerifyNetworkCheckName =
  | "networkFeeETH"
  | "liquidationThresholdETH"
  | "minimumLiquidationCollateralETH"
  | "networkFeeSSV"
  | "liquidationThresholdSSV"
  | "minimumLiquidationCollateralSSV";

type BaseCheckName = "networkFee" | "liquidationThreshold" | "minimumLiquidationCollateral";

export interface VerifyNetworkCheckResult {
  name: VerifyNetworkCheckName;
  asset: FeeAsset;
  status: CheckStatus;
  detail: string;
  subgraphValue: string;
  viewsValue: string;
}

export interface VerifyNetworkAssetResult {
  asset: FeeAsset;
  status: CheckStatus;
  checks: VerifyNetworkCheckResult[];
}

export interface VerifyNetworkResult {
  network: SingleNetwork;
  subgraphSource: "primary" | "fallback";
  status: CheckStatus;
  assetResults: VerifyNetworkAssetResult[];
  checks: VerifyNetworkCheckResult[];
}

export interface VerifyNetworkRunResult {
  selectedNetwork: RuntimeConfig["selectedNetwork"];
  status: CheckStatus;
  networkResults: VerifyNetworkResult[];
}

export interface VerifyNetworkDependencies {
  fetchFn?: typeof fetch;
  fetchDaoValues?: typeof fetchSubgraphDaoValues;
}

function qualifyCheckName(asset: FeeAsset, name: BaseCheckName): VerifyNetworkCheckName {
  if (name === "networkFee") {
    return asset === "ETH" ? "networkFeeETH" : "networkFeeSSV";
  }

  if (name === "liquidationThreshold") {
    return asset === "ETH" ? "liquidationThresholdETH" : "liquidationThresholdSSV";
  }

  return asset === "ETH" ? "minimumLiquidationCollateralETH" : "minimumLiquidationCollateralSSV";
}

function createCheck(
  asset: FeeAsset,
  name: BaseCheckName,
  subgraphValue: string,
  viewsValue: bigint,
  matchedDetail: string,
  mismatchedDetail: string,
): VerifyNetworkCheckResult {
  const viewsString = viewsValue.toString();
  const status = BigInt(subgraphValue) === viewsValue ? "pass" : "fail";

  return {
    name: qualifyCheckName(asset, name),
    asset,
    status,
    detail: status === "pass" ? matchedDetail : mismatchedDetail,
    subgraphValue,
    viewsValue: viewsString,
  };
}

async function verifyNetworkForAsset(
  asset: FeeAsset,
  rpcClient: RpcClient,
  viewsAddress: string,
  daoValues: Awaited<ReturnType<typeof fetchSubgraphDaoValues>>["daoValues"],
): Promise<VerifyNetworkAssetResult> {
  const views = createViewsAdapter(rpcClient, viewsAddress);
  const [networkFee, liquidationThreshold, minimumLiquidationCollateral] = await Promise.all([
    views.getNetworkFee(asset),
    views.getLiquidationThreshold(asset),
    views.getMinimumLiquidationCollateral(asset),
  ]);
  const checks = asset === "ETH"
    ? [
        createCheck(asset, "networkFee", daoValues.networkFee, networkFee, "ETH network fee matched Views", "ETH network fee did not match Views"),
        createCheck(
          asset,
          "liquidationThreshold",
          daoValues.liquidationThreshold,
          liquidationThreshold,
          "ETH liquidation threshold matched Views",
          "ETH liquidation threshold did not match Views",
        ),
        createCheck(
          asset,
          "minimumLiquidationCollateral",
          daoValues.minimumLiquidationCollateral,
          minimumLiquidationCollateral,
          "ETH minimum liquidation collateral matched Views",
          "ETH minimum liquidation collateral did not match Views",
        ),
      ]
    : [
        createCheck(asset, "networkFee", daoValues.networkFeeSSV, networkFee, "SSV network fee matched Views", "SSV network fee did not match Views"),
        createCheck(
          asset,
          "liquidationThreshold",
          daoValues.liquidationThresholdSSV,
          liquidationThreshold,
          "SSV liquidation threshold matched Views",
          "SSV liquidation threshold did not match Views",
        ),
        createCheck(
          asset,
          "minimumLiquidationCollateral",
          daoValues.minimumLiquidationCollateralSSV,
          minimumLiquidationCollateral,
          "SSV minimum liquidation collateral matched Views",
          "SSV minimum liquidation collateral did not match Views",
        ),
      ];

  return {
    asset,
    status: summarizeStatuses(checks.map((check) => check.status)),
    checks,
  };
}

async function verifySingleNetwork(
  config: RuntimeConfig,
  network: SingleNetwork,
  dependencies: VerifyNetworkDependencies,
  bar?: Bar,
): Promise<VerifyNetworkResult> {
  const fetchFn = dependencies.fetchFn ?? fetch;
  const fetchDaoValues = dependencies.fetchDaoValues ?? fetchSubgraphDaoValues;
  const networkConfig = config.networks[network];
  const rpcClient = createNetworkRpcPool(config, networkConfig, fetchFn);
  const subgraphDaoValues = await fetchDaoValues(
    networkConfig.subgraphPrimaryUrl,
    networkConfig.subgraphFallbackUrl,
    networkConfig.daoAddress,
    fetchFn,
  );
  bar?.tick();
  const ethResult = await verifyNetworkForAsset("ETH", rpcClient, networkConfig.viewsAddress, subgraphDaoValues.daoValues);
  bar?.tick();
  const ssvResult = await verifyNetworkForAsset("SSV", rpcClient, networkConfig.viewsAddress, subgraphDaoValues.daoValues);
  bar?.tick();
  const assetResults = [ethResult, ssvResult];

  return {
    network,
    subgraphSource: subgraphDaoValues.source,
    status: summarizeStatuses(assetResults.map((assetResult) => assetResult.status)),
    assetResults,
    checks: assetResults.flatMap((assetResult) => assetResult.checks),
  };
}

export async function verifyNetwork(
  config: RuntimeConfig,
  dependencies: VerifyNetworkDependencies = {},
  reporter?: ProgressReporter,
): Promise<VerifyNetworkRunResult> {
  const totalSteps = config.activeNetworks.length * 3;
  const bar = totalSteps > 0 ? reporter?.bar(totalSteps, "Verifying network constants") : undefined;
  let networkResults: VerifyNetworkResult[];
  if (reporter) {
    networkResults = [];
    for (const network of config.activeNetworks) {
      networkResults.push(await verifySingleNetwork(config, network, dependencies, bar));
    }
  } else {
    networkResults = await Promise.all(
      config.activeNetworks.map((network) => verifySingleNetwork(config, network, dependencies)),
    );
  }
  bar?.stop();

  return {
    selectedNetwork: config.selectedNetwork,
    status: summarizeStatuses(networkResults.map((result) => result.status)),
    networkResults,
  };
}

function renderCheckLabel(checkName: VerifyNetworkCheckName): string {
  return checkName.replace(/(ETH|SSV)$/, "");
}

export function renderVerifyNetworkSummary(result: VerifyNetworkRunResult): string {
  const lines = [
    `verify-network ${result.status.toUpperCase()}`,
    `network selection: ${result.selectedNetwork}`,
  ];

  for (const networkResult of result.networkResults) {
    lines.push(`${networkResult.network}: ${networkResult.status.toUpperCase()} (source=${networkResult.subgraphSource})`);

    for (const assetResult of networkResult.assetResults) {
      lines.push(`- ${assetResult.asset}: ${assetResult.status.toUpperCase()}`);

      for (const check of assetResult.checks) {
        lines.push(
          `- ${renderCheckLabel(check.name)}: ${check.status.toUpperCase()} (subgraph=${check.subgraphValue}; views=${check.viewsValue}; ${check.detail})`,
        );
      }
    }
  }

  return lines.join("\n");
}

export function renderVerifyNetworkJson(result: VerifyNetworkRunResult): string {
  return JSON.stringify(result, null, 2);
}
