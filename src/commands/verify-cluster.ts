import type { RuntimeConfig } from "../config/env.js";
import type { SingleNetwork } from "../config/networks.js";
import { jsonRpcRequest } from "../clients/json-rpc.js";
import { fetchSubgraphClusterAccounting } from "../clients/subgraph.js";
import { summarizeStatuses, type CheckStatus } from "../status.js";
import {
  createViewsAdapter,
  type FeeAsset,
  type ViewsClusterState,
} from "../clients/views.js";

const ETH_PRECISION = 100_000n;
const LEGACY_SSV_PRECISION = 10_000_000n;

export interface SubgraphFreshness {
  indexedBlockNumber: number;
  chainHeadBlockNumber: number;
  lagBlocks: number;
  status: "fresh" | "lagging";
}

export type CheckClassification = "verified" | "mismatch" | "lag-affected" | "inconclusive";

export interface ClusterIdentityCheckResult {
  name:
    | "assetType"
    | "owner"
    | "operatorIds"
    | "validatorCount"
    | "active"
    | "effectiveBalance"
    | "currentBalance"
    | "burnRate"
    | "liquidationCollateral"
    | "liquidatable";
  status: CheckStatus;
  classification: CheckClassification;
  detail: string;
  subgraphValue: string;
  viewsValue?: string;
}

export interface VerifyClusterResult {
  network: SingleNetwork;
  clusterId: string;
  subgraphSource: "primary" | "fallback";
  freshness: SubgraphFreshness;
  status: CheckStatus;
  checks: ClusterIdentityCheckResult[];
}

export interface VerifyClusterDependencies {
  fetchFn?: typeof fetch;
}

interface NormalizedCluster {
  id: string;
  owner: string;
  feeAsset: FeeAsset;
  effectiveBalance: bigint | null;
  operatorIds: bigint[];
  validatorCount: number;
  networkFeeIndex: bigint;
  index: bigint;
  active: boolean;
  balance: bigint;
}

interface NormalizedOperator {
  id: bigint;
  fee: bigint;
  feeIndex: bigint;
  feeIndexBlockNumber: bigint;
  feeSSV: bigint;
  feeIndexSSV: bigint;
  feeIndexBlockNumberSSV: bigint;
}

interface NormalizedDaoValues {
  networkFee: bigint;
  networkFeeIndex: bigint;
  networkFeeIndexBlockNumber: bigint;
  liquidationThreshold: bigint;
  minimumLiquidationCollateral: bigint;
  networkFeeSSV: bigint;
  networkFeeIndexSSV: bigint;
  networkFeeIndexBlockNumberSSV: bigint;
  liquidationThresholdSSV: bigint;
  minimumLiquidationCollateralSSV: bigint;
}

function normalizeClusterValue(cluster: {
  id: string;
  owner: { id: string };
  feeAsset?: string | null;
  effectiveBalance?: string | null;
  operatorIds: string[];
  validatorCount: string;
  networkFeeIndex: string;
  index: string;
  active: boolean;
  balance: string;
}): NormalizedCluster {
  return {
    id: cluster.id,
    owner: cluster.owner.id.toLowerCase(),
    feeAsset: cluster.feeAsset === "ETH" ? "ETH" : "SSV",
    effectiveBalance: cluster.effectiveBalance ? BigInt(cluster.effectiveBalance) : null,
    operatorIds: cluster.operatorIds.map((operatorId) => BigInt(operatorId)),
    validatorCount: Number.parseInt(cluster.validatorCount, 10),
    networkFeeIndex: BigInt(cluster.networkFeeIndex),
    index: BigInt(cluster.index),
    active: cluster.active,
    balance: BigInt(cluster.balance),
  };
}

function normalizeOperatorValue(operator: {
  id: string;
  fee: string;
  feeIndex: string;
  feeIndexBlockNumber: string;
  feeSSV?: string;
  feeIndexSSV?: string;
  feeIndexBlockNumberSSV?: string;
}): NormalizedOperator {
  return {
    id: BigInt(operator.id),
    fee: BigInt(operator.fee),
    feeIndex: BigInt(operator.feeIndex),
    feeIndexBlockNumber: BigInt(operator.feeIndexBlockNumber),
    feeSSV: BigInt(operator.feeSSV ?? operator.fee),
    feeIndexSSV: BigInt(operator.feeIndexSSV ?? operator.feeIndex),
    feeIndexBlockNumberSSV: BigInt(operator.feeIndexBlockNumberSSV ?? operator.feeIndexBlockNumber),
  };
}

function normalizeDaoValues(daoValues: {
  networkFee: string;
  networkFeeIndex: string;
  networkFeeIndexBlockNumber: string;
  liquidationThreshold: string;
  minimumLiquidationCollateral: string;
  networkFeeSSV?: string;
  networkFeeIndexSSV?: string;
  networkFeeIndexBlockNumberSSV?: string;
  liquidationThresholdSSV?: string;
  minimumLiquidationCollateralSSV?: string;
}): NormalizedDaoValues {
  return {
    networkFee: BigInt(daoValues.networkFee),
    networkFeeIndex: BigInt(daoValues.networkFeeIndex),
    networkFeeIndexBlockNumber: BigInt(daoValues.networkFeeIndexBlockNumber),
    liquidationThreshold: BigInt(daoValues.liquidationThreshold),
    minimumLiquidationCollateral: BigInt(daoValues.minimumLiquidationCollateral),
    networkFeeSSV: BigInt(daoValues.networkFeeSSV ?? daoValues.networkFee),
    networkFeeIndexSSV: BigInt(daoValues.networkFeeIndexSSV ?? daoValues.networkFeeIndex),
    networkFeeIndexBlockNumberSSV: BigInt(daoValues.networkFeeIndexBlockNumberSSV ?? daoValues.networkFeeIndexBlockNumber),
    liquidationThresholdSSV: BigInt(daoValues.liquidationThresholdSSV ?? daoValues.liquidationThreshold),
    minimumLiquidationCollateralSSV: BigInt(daoValues.minimumLiquidationCollateralSSV ?? daoValues.minimumLiquidationCollateral),
  };
}

function toViewsClusterState(cluster: NormalizedCluster): ViewsClusterState {
  return {
    validatorCount: cluster.validatorCount,
    networkFeeIndex: cluster.networkFeeIndex,
    index: cluster.index,
    active: cluster.active,
    balance: cluster.balance,
  };
}

function mutateAddress(address: string): string {
  const value = BigInt(address);
  const mutated = (value + 1n) % (1n << 160n);
  return `0x${mutated.toString(16).padStart(40, "0")}`;
}

function mutateOperatorIds(operatorIds: bigint[]): bigint[] {
  if (operatorIds.length === 0) {
    return [1n];
  }

  const mutated = [...operatorIds];
  const lastIndex = mutated.length - 1;
  mutated[lastIndex] = mutated[lastIndex]! + 1n;
  return mutated;
}

function formatOperatorIds(operatorIds: bigint[]): string {
  return operatorIds.map((operatorId) => operatorId.toString()).join(", ");
}

function createFailureCheck(
  name: ClusterIdentityCheckResult["name"],
  subgraphValue: string,
  detail: string,
  viewsValue?: string,
): ClusterIdentityCheckResult {
  return {
    name,
    status: "fail",
    classification: "mismatch",
    subgraphValue,
    detail,
    ...(viewsValue ? { viewsValue } : {}),
  };
}

function createInconclusiveCheck(
  name: ClusterIdentityCheckResult["name"],
  subgraphValue: string,
  detail: string,
): ClusterIdentityCheckResult {
  return {
    name,
    status: "inconclusive",
    classification: "inconclusive",
    subgraphValue,
    detail,
  };
}

function createFreshness(indexedBlockNumber: bigint, chainHeadBlockNumber: bigint): SubgraphFreshness {
  const lagBlocks = chainHeadBlockNumber > indexedBlockNumber ? chainHeadBlockNumber - indexedBlockNumber : 0n;

  return {
    indexedBlockNumber: Number(indexedBlockNumber),
    chainHeadBlockNumber: Number(chainHeadBlockNumber),
    lagBlocks: Number(lagBlocks),
    status: lagBlocks === 0n ? "fresh" : "lagging",
  };
}

function applyFreshnessClassification(
  checks: ClusterIdentityCheckResult[],
  freshness: SubgraphFreshness,
): ClusterIdentityCheckResult[] {
  if (freshness.status === "fresh") {
    return checks.map((check) => ({
      ...check,
      classification: check.status === "pass"
        ? "verified"
        : check.status === "inconclusive"
          ? "inconclusive"
          : "mismatch",
    }));
  }

  return checks.map((check) => {
    if (check.status === "inconclusive") {
      return check;
    }

    if (check.status !== "fail") {
      return {
        ...check,
        classification: "verified",
      };
    }

    return {
      ...check,
      status: "warn",
      classification: "lag-affected",
      detail: `${check.detail}; subgraph trails chain head by ${freshness.lagBlocks} block(s)`,
    };
  });
}

function summarizeStatus(checks: ClusterIdentityCheckResult[]): CheckStatus {
  return summarizeStatuses(checks.map((check) => check.status));
}

function currentIndex(
  baseIndex: bigint,
  fee: bigint,
  startBlock: bigint,
  currentBlock: bigint,
  precision: bigint,
): bigint {
  return (baseIndex * precision) + ((currentBlock - startBlock) * fee);
}

function precisionForAsset(asset: FeeAsset): bigint {
  return asset === "ETH" ? ETH_PRECISION : LEGACY_SSV_PRECISION;
}

function clusterScale(cluster: Pick<NormalizedCluster, "feeAsset" | "effectiveBalance" | "validatorCount">): bigint {
  return cluster.feeAsset === "ETH"
    ? (cluster.effectiveBalance ?? 0n) / 32n
    : BigInt(cluster.validatorCount);
}

function selectOperatorAccounting(
  asset: FeeAsset,
  operators: ReadonlyArray<NormalizedOperator>,
): Array<Pick<NormalizedOperator, "fee" | "feeIndex" | "feeIndexBlockNumber">> {
  return operators.map((operator) => asset === "ETH"
    ? {
        fee: operator.fee,
        feeIndex: operator.feeIndex,
        feeIndexBlockNumber: operator.feeIndexBlockNumber,
      }
    : {
        fee: operator.feeSSV,
        feeIndex: operator.feeIndexSSV,
        feeIndexBlockNumber: operator.feeIndexBlockNumberSSV,
      });
}

function selectDaoAccounting(
  asset: FeeAsset,
  daoValues: NormalizedDaoValues,
): Pick<NormalizedDaoValues, "networkFee" | "networkFeeIndex" | "networkFeeIndexBlockNumber" | "liquidationThreshold" | "minimumLiquidationCollateral"> {
  return asset === "ETH"
    ? {
        networkFee: daoValues.networkFee,
        networkFeeIndex: daoValues.networkFeeIndex,
        networkFeeIndexBlockNumber: daoValues.networkFeeIndexBlockNumber,
        liquidationThreshold: daoValues.liquidationThreshold,
        minimumLiquidationCollateral: daoValues.minimumLiquidationCollateral,
      }
    : {
        networkFee: daoValues.networkFeeSSV,
        networkFeeIndex: daoValues.networkFeeIndexSSV,
        networkFeeIndexBlockNumber: daoValues.networkFeeIndexBlockNumberSSV,
        liquidationThreshold: daoValues.liquidationThresholdSSV,
        minimumLiquidationCollateral: daoValues.minimumLiquidationCollateralSSV,
      };
}

export function deriveCurrentClusterBalance(
  cluster: Pick<NormalizedCluster, "feeAsset" | "effectiveBalance" | "validatorCount" | "networkFeeIndex" | "index" | "balance">,
  operators: ReadonlyArray<Pick<NormalizedOperator, "fee" | "feeIndex" | "feeIndexBlockNumber">>,
  daoValues: Pick<NormalizedDaoValues, "networkFee" | "networkFeeIndex" | "networkFeeIndexBlockNumber">,
  currentBlock: bigint,
): bigint {
  const precision = precisionForAsset(cluster.feeAsset);
  const operatorIndexes = operators.reduce(
    (sum, operator) => sum + currentIndex(operator.feeIndex, operator.fee, operator.feeIndexBlockNumber, currentBlock, precision),
    0n,
  );
  const networkIndex = currentIndex(
    daoValues.networkFeeIndex,
    daoValues.networkFee,
    daoValues.networkFeeIndexBlockNumber,
    currentBlock,
    precision,
  );
  const totalCurrentIndexes = operatorIndexes + networkIndex;
  const totalClusterIndex = (cluster.index * precision) + (cluster.networkFeeIndex * precision);
  const indexDelta = totalCurrentIndexes - totalClusterIndex;
  const scale = cluster.feeAsset === "ETH"
    ? (cluster.effectiveBalance ?? 0n) / 32n
    : BigInt(cluster.validatorCount);
  const currentBalance = cluster.balance - (indexDelta * scale);

  return currentBalance > 0n ? currentBalance : 0n;
}

export function deriveClusterBurnRate(
  cluster: Pick<NormalizedCluster, "feeAsset" | "effectiveBalance" | "validatorCount">,
  operators: ReadonlyArray<Pick<NormalizedOperator, "fee">>,
  daoValues: Pick<NormalizedDaoValues, "networkFee">,
): bigint {
  const operatorFees = operators.reduce((sum, operator) => sum + operator.fee, 0n);
  return (operatorFees + daoValues.networkFee) * clusterScale(cluster);
}

export function deriveLiquidationCollateral(
  burnRate: bigint,
  daoValues: Pick<NormalizedDaoValues, "liquidationThreshold" | "minimumLiquidationCollateral">,
): bigint {
  const threshold = burnRate * daoValues.liquidationThreshold;
  return threshold > daoValues.minimumLiquidationCollateral ? threshold : daoValues.minimumLiquidationCollateral;
}

export function deriveLiquidatableStatus(active: boolean, currentBalance: bigint, liquidationCollateral: bigint): boolean {
  return active && currentBalance < liquidationCollateral;
}

function hexToBigInt(value: string): bigint {
  return BigInt(value);
}

async function runMutationCheck(
  name: ClusterIdentityCheckResult["name"],
  subgraphValue: string,
  validator: () => Promise<{ status: "success" | "revert"; detail: string }>,
): Promise<ClusterIdentityCheckResult> {
  const result = await validator();

  if (result.status === "revert") {
    return {
      name,
      status: "pass",
      classification: "verified",
      subgraphValue,
      detail: `Subgraph value matched the Views-validated state; altered input was rejected (${result.detail})`,
    };
  }

  return {
    name,
    status: "fail",
    classification: "mismatch",
    subgraphValue,
    detail: `Views also accepted an altered ${name} value, so the match could not be proven`,
  };
}

function createAssetTypeCheck(subgraphAsset: FeeAsset, onChainAsset: FeeAsset): ClusterIdentityCheckResult {
  const status: CheckStatus = subgraphAsset === onChainAsset ? "pass" : "fail";

  return {
    name: "assetType",
    status,
    classification: status === "pass" ? "verified" : "mismatch",
    subgraphValue: subgraphAsset,
    viewsValue: onChainAsset,
    detail: status === "pass"
      ? `Subgraph asset type matched the on-chain ${onChainAsset} Views surface`
      : `Subgraph asset type did not match the on-chain ${onChainAsset} Views surface`,
  };
}

async function inferOnChainAsset(
  views: ReturnType<typeof createViewsAdapter>,
  cluster: NormalizedCluster,
): Promise<{
  asset: FeeAsset | null;
  validations: Record<FeeAsset, Awaited<ReturnType<ReturnType<typeof createViewsAdapter>["validateClusterState"]>>>;
}> {
  const [ethValidation, ssvValidation] = await Promise.all([
    views.validateClusterState("ETH", cluster.owner, cluster.operatorIds, toViewsClusterState(cluster)),
    views.validateClusterState("SSV", cluster.owner, cluster.operatorIds, toViewsClusterState(cluster)),
  ]);

  if (ethValidation.status === "success" && ssvValidation.status === "revert") {
    return {
      asset: "ETH",
      validations: {
        ETH: ethValidation,
        SSV: ssvValidation,
      },
    };
  }

  if (ethValidation.status === "revert" && ssvValidation.status === "success") {
    return {
      asset: "SSV",
      validations: {
        ETH: ethValidation,
        SSV: ssvValidation,
      },
    };
  }

  return {
    asset: null,
    validations: {
      ETH: ethValidation,
      SSV: ssvValidation,
    },
  };
}

export async function verifyClusterIdentity(
  config: RuntimeConfig,
  clusterId: string,
  dependencies: VerifyClusterDependencies = {},
): Promise<VerifyClusterResult> {
  if (config.activeNetworks.length !== 1) {
    throw new Error("verify-cluster requires a single network target, not --network both.");
  }

  const fetchFn = dependencies.fetchFn ?? fetch;
  const network = config.activeNetworks[0]!;
  const networkConfig = config.networks[network];
  const chainHeadBlockPromise = jsonRpcRequest<string>(
    networkConfig.rpcUrl,
    "eth_blockNumber",
    [],
    fetchFn,
  ).then(hexToBigInt);
  const subgraphAccounting = await fetchSubgraphClusterAccounting(
    networkConfig.subgraphPrimaryUrl,
    networkConfig.subgraphFallbackUrl,
    clusterId,
    networkConfig.daoAddress,
    fetchFn,
  );
  const cluster = normalizeClusterValue(subgraphAccounting.cluster);
  const operators = subgraphAccounting.operators.map(normalizeOperatorValue);
  const daoValues = normalizeDaoValues(subgraphAccounting.daoValues);
  const chainHeadBlock = await chainHeadBlockPromise;
  const freshness = createFreshness(BigInt(subgraphAccounting.indexedBlockNumber), chainHeadBlock);
  const views = createViewsAdapter(networkConfig.rpcUrl, networkConfig.viewsAddress, fetchFn);
  const inferredAsset = await inferOnChainAsset(views, cluster);
  const assetTypeCheck = inferredAsset.asset
    ? createAssetTypeCheck(cluster.feeAsset, inferredAsset.asset)
    : createInconclusiveCheck(
        "assetType",
        cluster.feeAsset,
        `Unable to infer on-chain asset type from Views (ETH=${inferredAsset.validations.ETH.status}: ${inferredAsset.validations.ETH.detail}; SSV=${inferredAsset.validations.SSV.status}: ${inferredAsset.validations.SSV.detail})`,
      );
  const validationAsset = inferredAsset.asset ?? cluster.feeAsset;
  const baseline = inferredAsset.validations[validationAsset];
  const baselineFailure = `Views rejected the subgraph cluster state on the ${validationAsset} surface: ${baseline.detail}`;
  const selectedOperators = selectOperatorAccounting(validationAsset, operators);
  const selectedDaoValues = selectDaoAccounting(validationAsset, daoValues);

  const checks = baseline.status === "revert"
    ? [
        assetTypeCheck,
        createFailureCheck("owner", cluster.owner, baselineFailure),
        createFailureCheck("operatorIds", formatOperatorIds(cluster.operatorIds), baselineFailure),
        createFailureCheck("validatorCount", String(cluster.validatorCount), baselineFailure),
        createFailureCheck("active", String(cluster.active), baselineFailure),
        ...(cluster.feeAsset === "ETH" ? [createFailureCheck("effectiveBalance", String(cluster.effectiveBalance ?? "missing"), baselineFailure)] : []),
        createFailureCheck("currentBalance", cluster.balance.toString(), baselineFailure),
        createFailureCheck("burnRate", "unknown", baselineFailure),
        createFailureCheck("liquidationCollateral", "unknown", baselineFailure),
        createFailureCheck("liquidatable", "unknown", baselineFailure),
      ]
    : await (() => {
        const baseChecks = [assetTypeCheck];
        const identityChecksPromise = Promise.all([
          runMutationCheck("owner", cluster.owner, () =>
            views.validateClusterState(validationAsset, mutateAddress(cluster.owner), cluster.operatorIds, toViewsClusterState(cluster))
          ),
          runMutationCheck("operatorIds", formatOperatorIds(cluster.operatorIds), () =>
            views.validateClusterState(validationAsset, cluster.owner, mutateOperatorIds(cluster.operatorIds), toViewsClusterState(cluster))
          ),
          runMutationCheck("validatorCount", String(cluster.validatorCount), () =>
            views.validateClusterState(validationAsset, cluster.owner, cluster.operatorIds, {
              ...toViewsClusterState(cluster),
              validatorCount: cluster.validatorCount + 1,
            })
          ),
          runMutationCheck("active", String(cluster.active), () =>
            views.validateClusterState(validationAsset, cluster.owner, cluster.operatorIds, {
              ...toViewsClusterState(cluster),
              active: !cluster.active,
            })
          ),
        ]);

        if (assetTypeCheck.status === "fail") {
          return identityChecksPromise.then((identityChecks) => [
            ...baseChecks,
            ...identityChecks,
            createInconclusiveCheck("currentBalance", cluster.balance.toString(), `Skipped ${cluster.feeAsset} accounting checks because the on-chain cluster is ${validationAsset}`),
            createInconclusiveCheck("burnRate", "unknown", `Skipped ${cluster.feeAsset} accounting checks because the on-chain cluster is ${validationAsset}`),
            createInconclusiveCheck("liquidationCollateral", "unknown", `Skipped ${cluster.feeAsset} accounting checks because the on-chain cluster is ${validationAsset}`),
            createInconclusiveCheck("liquidatable", "unknown", `Skipped ${cluster.feeAsset} accounting checks because the on-chain cluster is ${validationAsset}`),
          ]);
        }

        if (cluster.feeAsset === "ETH") {
          const effectiveBalanceCheck = cluster.effectiveBalance !== null
            && cluster.effectiveBalance > 0n
            && cluster.effectiveBalance % 32n === 0n
            ? {
                name: "effectiveBalance",
                status: "pass",
                classification: "verified",
                subgraphValue: cluster.effectiveBalance.toString(),
                detail: `ETH effective balance was present and produced scale ${(cluster.effectiveBalance / 32n).toString()}`,
              } satisfies ClusterIdentityCheckResult
            : createFailureCheck(
                "effectiveBalance",
                cluster.effectiveBalance?.toString() ?? "missing",
                "ETH effective balance must be present, positive, and divisible by 32",
              );

          const viewsBalancePromise = views.getClusterBalance(validationAsset, cluster.owner, cluster.operatorIds, toViewsClusterState(cluster));
          const viewsBurnRatePromise = views.getClusterBurnRate(validationAsset, cluster.owner, cluster.operatorIds, toViewsClusterState(cluster));

          return Promise.all([
            identityChecksPromise,
            viewsBalancePromise,
            viewsBurnRatePromise,
          ]).then(([identityChecks, viewsBalance, viewsBurnRate]) => {
            const derivedBalance = deriveCurrentClusterBalance(cluster, selectedOperators, selectedDaoValues, chainHeadBlock);
            const derivedBurnRate = deriveClusterBurnRate(cluster, selectedOperators, selectedDaoValues);

            return [
              ...baseChecks,
              ...identityChecks,
              effectiveBalanceCheck,
              {
                name: "currentBalance",
                status: derivedBalance === viewsBalance ? "pass" : "fail",
                classification: derivedBalance === viewsBalance ? "verified" : "mismatch",
                subgraphValue: derivedBalance.toString(),
                viewsValue: viewsBalance.toString(),
                detail: derivedBalance === viewsBalance
                  ? `Derived balance matched Views at block ${chainHeadBlock.toString()}`
                  : `Derived balance did not match Views at block ${chainHeadBlock.toString()}`,
              } satisfies ClusterIdentityCheckResult,
              {
                name: "burnRate",
                status: derivedBurnRate === viewsBurnRate ? "pass" : "fail",
                classification: derivedBurnRate === viewsBurnRate ? "verified" : "mismatch",
                subgraphValue: derivedBurnRate.toString(),
                viewsValue: viewsBurnRate.toString(),
                detail: derivedBurnRate === viewsBurnRate ? "Derived burn rate matched Views" : "Derived burn rate did not match Views",
              } satisfies ClusterIdentityCheckResult,
              createInconclusiveCheck("liquidationCollateral", "unknown", "ETH liquidation verification lands in the follow-up liquidation slice"),
              createInconclusiveCheck("liquidatable", "unknown", "ETH liquidation verification lands in the follow-up liquidation slice"),
            ];
          });
        }

        const viewsBalancePromise = views.getClusterBalance(validationAsset, cluster.owner, cluster.operatorIds, toViewsClusterState(cluster));
        const viewsBurnRatePromise = views.getClusterBurnRate(validationAsset, cluster.owner, cluster.operatorIds, toViewsClusterState(cluster));
        const viewsLiquidatablePromise = views.getClusterLiquidatable(validationAsset, cluster.owner, cluster.operatorIds, toViewsClusterState(cluster));

        return Promise.all([
          identityChecksPromise,
          viewsBalancePromise,
          viewsBurnRatePromise,
          viewsLiquidatablePromise,
        ]).then(([identityChecks, viewsBalance, viewsBurnRate, viewsLiquidatable]) => {
          const derivedBalance = deriveCurrentClusterBalance(cluster, selectedOperators, selectedDaoValues, chainHeadBlock);
          const derivedBurnRate = deriveClusterBurnRate(cluster, selectedOperators, selectedDaoValues);
          const liquidationCollateral = deriveLiquidationCollateral(derivedBurnRate, selectedDaoValues);
          const expectedLiquidatable = deriveLiquidatableStatus(cluster.active, derivedBalance, liquidationCollateral);

          return [
            ...baseChecks,
            ...identityChecks,
            {
              name: "currentBalance",
              status: derivedBalance === viewsBalance ? "pass" : "fail",
              classification: derivedBalance === viewsBalance ? "verified" : "mismatch",
              subgraphValue: derivedBalance.toString(),
              viewsValue: viewsBalance.toString(),
              detail: derivedBalance === viewsBalance
                ? `Derived balance matched Views at block ${chainHeadBlock.toString()}`
                : `Derived balance did not match Views at block ${chainHeadBlock.toString()}`,
            } satisfies ClusterIdentityCheckResult,
            {
              name: "burnRate",
              status: derivedBurnRate === viewsBurnRate ? "pass" : "fail",
              classification: derivedBurnRate === viewsBurnRate ? "verified" : "mismatch",
              subgraphValue: derivedBurnRate.toString(),
              viewsValue: viewsBurnRate.toString(),
              detail: derivedBurnRate === viewsBurnRate ? "Derived burn rate matched Views" : "Derived burn rate did not match Views",
            } satisfies ClusterIdentityCheckResult,
            {
              name: "liquidationCollateral",
              status: expectedLiquidatable === viewsLiquidatable ? "pass" : "fail",
              classification: expectedLiquidatable === viewsLiquidatable ? "verified" : "mismatch",
              subgraphValue: liquidationCollateral.toString(),
              viewsValue: String(viewsLiquidatable),
              detail: expectedLiquidatable === viewsLiquidatable
                ? `Derived collateral implied the same liquidatable status as Views at block ${chainHeadBlock.toString()} (balance=${derivedBalance.toString()})`
                : `Derived collateral implied a different liquidatable status than Views at block ${chainHeadBlock.toString()} (balance=${derivedBalance.toString()})`,
            } satisfies ClusterIdentityCheckResult,
            {
              name: "liquidatable",
              status: expectedLiquidatable === viewsLiquidatable ? "pass" : "fail",
              classification: expectedLiquidatable === viewsLiquidatable ? "verified" : "mismatch",
              subgraphValue: String(expectedLiquidatable),
              viewsValue: String(viewsLiquidatable),
              detail: expectedLiquidatable === viewsLiquidatable
                ? `Derived liquidatable status matched Views at block ${chainHeadBlock.toString()} (balance=${viewsBalance.toString()}, collateral=${liquidationCollateral.toString()})`
                : `Derived liquidatable status did not match Views at block ${chainHeadBlock.toString()} (balance=${viewsBalance.toString()}, collateral=${liquidationCollateral.toString()})`,
            } satisfies ClusterIdentityCheckResult,
          ];
        });
      })();

  const classifiedChecks = applyFreshnessClassification(checks, freshness);

  return {
    network,
    clusterId: cluster.id,
    subgraphSource: subgraphAccounting.source,
    freshness,
    status: summarizeStatus(classifiedChecks),
    checks: classifiedChecks,
  };
}

export function renderVerifyClusterSummary(result: VerifyClusterResult): string {
  const lines = [
    `verify-cluster ${result.status.toUpperCase()}`,
    `network: ${result.network}`,
    `cluster: ${result.clusterId}`,
    `subgraph source: ${result.subgraphSource}`,
    `subgraph freshness: ${result.freshness.status} (indexed=${result.freshness.indexedBlockNumber}, chainHead=${result.freshness.chainHeadBlockNumber}, lag=${result.freshness.lagBlocks})`,
  ];

  for (const check of result.checks) {
    const values = check.viewsValue
      ? `expected=${check.subgraphValue}; views=${check.viewsValue}`
      : `subgraph=${check.subgraphValue}`;
    lines.push(`- ${check.name}: ${check.status.toUpperCase()} [${check.classification}] (${values}; ${check.detail})`);
  }

  return lines.join("\n");
}

export function renderVerifyClusterJson(result: VerifyClusterResult): string {
  return JSON.stringify(result, null, 2);
}
