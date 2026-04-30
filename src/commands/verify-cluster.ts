import type { RuntimeConfig } from "../config/env.js";
import type { SingleNetwork } from "../config/networks.js";
import type { ProgressReporter } from "../ui/progress.js";
import { createNetworkRpcPool } from "../clients/rpc-pool.js";
import { fetchPinnedSubgraphClusterSnapshot } from "../clients/subgraph.js";
import { parseClusterId } from "../domain/cluster-id.js";
import {
  deriveClusterBurnRate,
  deriveCurrentClusterBalance,
  deriveLiquidatableStatus,
  deriveLiquidationCollateral,
} from "../domain/cluster-accounting.js";
import { summarizeStatuses, type CheckStatus } from "../status.js";
import {
  createViewsAdapter,
  type FeeAsset,
  type ViewsAdapter,
  type ViewsClusterState,
} from "../clients/views.js";

export interface SubgraphFreshness {
  indexedBlockNumber: number;
  chainHeadBlockNumber: number;
  lagBlocks: number;
  status: "fresh" | "lagging";
}

export type CheckClassification = "verified" | "mismatch" | "lag-affected" | "inconclusive";
export type ClusterCheckKind = "input" | "derived" | "operational";
export type ClusterCheckReason =
  | "matched"
  | "mismatch"
  | "invalid"
  | "missing"
  | "unavailable"
  | "blocked"
  | "lagging";

export interface ClusterIdentityCheckResult {
  name:
    | "clusterState"
    | "subgraphLag"
    | "assetType"
    | "daoData"
    | "operatorData"
    | "effectiveBalance"
    | "currentBalance"
    | "burnRate"
    | "liquidationCollateral"
    | "liquidatable";
  kind: ClusterCheckKind;
  status: CheckStatus;
  reason: ClusterCheckReason;
  classification: CheckClassification;
  detail: string;
  subgraphValue: string;
  viewsValue?: string;
  blockedBy?: string[];
  diagnostics?: ViewsReadFailureDiagnostic[];
}

export interface VerifyClusterResult {
  network: SingleNetwork;
  clusterId: string;
  subgraphSource: "primary" | "fallback";
  freshness: SubgraphFreshness;
  status: CheckStatus;
  checks: ClusterIdentityCheckResult[];
  accountingDebug: ClusterAccountingDebug;
}

export interface VerifyClusterDependencies {
  fetchFn?: typeof fetch;
}

export interface ViewsReadFailureDiagnostic {
  kind: "viewsReadFailed";
  read: "getBalance" | "getBurnRate" | "isLiquidatable" | "getLiquidationThresholdPeriod" | "getMinimumLiquidationCollateral";
  blockTag: string;
  message: string;
}

export interface ClusterAccountingDebug {
  failureStage?: ClusterIdentityCheckResult["name"] | "derived";
  selectedAsset?: FeeAsset;
  localInputs?: Record<string, unknown>;
  viewsInputs?: Record<string, unknown>;
  intermediates?: Record<string, unknown>;
}

interface NormalizedCluster {
  id: string;
  owner: string;
  feeAsset: string | null;
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

type SettledViewsRead<T> =
  | { status: "success"; value: T }
  | { status: "failed"; diagnostic: ViewsReadFailureDiagnostic };

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
    feeAsset: cluster.feeAsset ?? null,
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

function formatOperatorIds(operatorIds: bigint[]): string {
  return operatorIds.map((operatorId) => operatorId.toString()).join(", ");
}

function kindForCheckName(name: ClusterIdentityCheckResult["name"]): ClusterCheckKind {
  if (name === "currentBalance" || name === "burnRate" || name === "liquidationCollateral" || name === "liquidatable") {
    return "derived";
  }

  if (name === "subgraphLag") {
    return "operational";
  }

  return "input";
}

function reasonFromClassification(classification: CheckClassification, status: CheckStatus): ClusterCheckReason {
  if (status === "pass") {
    return "matched";
  }

  if (classification === "mismatch") {
    return "mismatch";
  }

  if (classification === "lag-affected") {
    return "lagging";
  }

  return "unavailable";
}

function withCheckContract(
  check: Omit<ClusterIdentityCheckResult, "kind" | "reason"> & Partial<Pick<ClusterIdentityCheckResult, "kind" | "reason">>,
): ClusterIdentityCheckResult {
  return {
    kind: check.kind ?? kindForCheckName(check.name),
    reason: check.reason ?? reasonFromClassification(check.classification, check.status),
    ...check,
  };
}

function emptyAccountingDebug(failureStage?: ClusterAccountingDebug["failureStage"]): ClusterAccountingDebug {
  return failureStage ? { failureStage } : {};
}

function summarizeAccountingDebug(checks: ReadonlyArray<ClusterIdentityCheckResult>, debug: ClusterAccountingDebug): ClusterAccountingDebug {
  if (debug.failureStage) {
    return debug;
  }

  const firstNonPassing = checks.find((check) => check.status !== "pass");

  if (!firstNonPassing) {
    return debug;
  }

  return {
    ...debug,
    failureStage: firstNonPassing.name,
  };
}

function createFailureCheck(
  name: ClusterIdentityCheckResult["name"],
  subgraphValue: string,
  detail: string,
  viewsValue?: string,
): ClusterIdentityCheckResult {
  return withCheckContract({
    name,
    status: "fail",
    reason: "mismatch",
    classification: "mismatch",
    subgraphValue,
    detail,
    ...(viewsValue ? { viewsValue } : {}),
  });
}

function createInconclusiveCheck(
  name: ClusterIdentityCheckResult["name"],
  subgraphValue: string,
  detail: string,
  blockedBy?: string[],
  diagnostics?: ViewsReadFailureDiagnostic[],
): ClusterIdentityCheckResult {
  return withCheckContract({
    name,
    status: "inconclusive",
    reason: blockedBy?.length ? "blocked" : "unavailable",
    classification: "inconclusive",
    subgraphValue,
    detail,
    ...(blockedBy ? { blockedBy } : {}),
    ...(diagnostics ? { diagnostics } : {}),
  });
}

function createBlockedCheck(
  name: ClusterIdentityCheckResult["name"],
  detail: string,
  blockedBy: ClusterIdentityCheckResult["name"],
): ClusterIdentityCheckResult {
  return createInconclusiveCheck(name, "blocked", detail, [blockedBy]);
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

function createSubgraphLagCheck(freshness: SubgraphFreshness): ClusterIdentityCheckResult {
  const withinBuffer = freshness.lagBlocks <= 3;

  return withCheckContract({
    name: "subgraphLag",
    kind: "operational",
    status: withinBuffer ? "pass" : "warn",
    reason: withinBuffer ? "matched" : "lagging",
    classification: withinBuffer ? "verified" : "lag-affected",
    subgraphValue: freshness.indexedBlockNumber.toString(),
    viewsValue: freshness.chainHeadBlockNumber.toString(),
    detail: withinBuffer
      ? `Subgraph verification block stayed within the 3-block operational buffer (lag=${freshness.lagBlocks})`
      : `Subgraph verification block lagged chain head by ${freshness.lagBlocks} block(s), exceeding the 3-block operational buffer`,
  });
}

function summarizeStatus(checks: ClusterIdentityCheckResult[]): CheckStatus {
  return summarizeStatuses(checks.map((check) => check.status));
}

interface DerivedClusterAccountingInputs {
  feeAsset: FeeAsset;
  effectiveBalance: bigint | null;
  validatorCount: number;
  networkFeeIndex: bigint;
  index: bigint;
  balance: bigint;
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

async function buildPinnedDerivedChecks(args: {
  views: ViewsAdapter;
  asset: FeeAsset;
  cluster: NormalizedCluster;
  operators: Array<Pick<NormalizedOperator, "fee" | "feeIndex" | "feeIndexBlockNumber">>;
  daoValues: Pick<NormalizedDaoValues, "networkFee" | "networkFeeIndex" | "networkFeeIndexBlockNumber" | "liquidationThreshold" | "minimumLiquidationCollateral">;
  baseChecks: ClusterIdentityCheckResult[];
  inputChecks: ClusterIdentityCheckResult[];
  verificationBlockNumber: bigint;
  verificationBlockTag: string;
  freshness: SubgraphFreshness;
}): Promise<{ checks: ClusterIdentityCheckResult[]; accountingDebug: ClusterAccountingDebug }> {
  const {
    views,
    asset,
    cluster,
    operators,
    daoValues,
    baseChecks,
    inputChecks,
    verificationBlockNumber,
    verificationBlockTag,
    freshness,
  } = args;
  const viewsClusterState = toViewsClusterState(cluster);
  const derivedBalance = deriveCurrentClusterBalance({ ...cluster, feeAsset: asset }, operators, daoValues, verificationBlockNumber);
  const derivedBurnRate = deriveClusterBurnRate({ ...cluster, feeAsset: asset }, operators, daoValues);
  const derivedLiquidationCollateral = deriveLiquidationCollateral(derivedBurnRate.value, daoValues);
  const expectedLiquidatable = deriveLiquidatableStatus(cluster.active, derivedBalance.value, derivedLiquidationCollateral.value);
  const accountingDebug: ClusterAccountingDebug = {
    selectedAsset: asset,
    localInputs: {
      cluster: {
        validatorCount: cluster.validatorCount,
        networkFeeIndex: cluster.networkFeeIndex,
        index: cluster.index,
        active: cluster.active,
        balance: cluster.balance,
        effectiveBalance: cluster.effectiveBalance,
      },
      operators,
      daoValues,
      verificationBlock: verificationBlockNumber,
    },
    viewsInputs: {
      blockTag: verificationBlockTag,
    },
    intermediates: {
      currentBalance: derivedBalance.terms,
      burnRate: derivedBurnRate.terms,
      liquidationCollateral: derivedLiquidationCollateral.terms,
      liquidatable: expectedLiquidatable.terms,
    },
  };

  const [
    viewsBalance,
    viewsBurnRate,
    viewsLiquidatable,
    viewsLiquidationThreshold,
    viewsMinimumCollateral,
  ] = await Promise.all([
    settleViewsRead(
      "getBalance",
      verificationBlockTag,
      views.getClusterBalance(asset, cluster.owner, cluster.operatorIds, viewsClusterState, verificationBlockTag),
    ),
    settleViewsRead(
      "getBurnRate",
      verificationBlockTag,
      views.getClusterBurnRate(asset, cluster.owner, cluster.operatorIds, viewsClusterState, verificationBlockTag),
    ),
    settleViewsRead(
      "isLiquidatable",
      verificationBlockTag,
      views.getClusterLiquidatable(asset, cluster.owner, cluster.operatorIds, viewsClusterState, verificationBlockTag),
    ),
    settleViewsRead(
      "getLiquidationThresholdPeriod",
      verificationBlockTag,
      views.getLiquidationThreshold(asset, verificationBlockTag),
    ),
    settleViewsRead(
      "getMinimumLiquidationCollateral",
      verificationBlockTag,
      views.getMinimumLiquidationCollateral(asset, verificationBlockTag),
    ),
  ]);

  const liquidationDiagnostics = collectViewsReadDiagnostics([
    viewsBurnRate,
    viewsLiquidationThreshold,
    viewsMinimumCollateral,
  ]);

  const checks = [
    ...baseChecks,
    ...inputChecks,
    viewsBalance.status === "success"
      ? createDerivedComparisonCheck(
          "currentBalance",
          derivedBalance.value.toString(),
          viewsBalance.value.toString(),
          derivedBalance.value === viewsBalance.value,
          `Derived balance matched pinned Views at block ${verificationBlockNumber.toString()}`,
          `Derived balance did not match pinned Views at block ${verificationBlockNumber.toString()}`,
        )
      : createViewsReadFailedCheck("currentBalance", derivedBalance.value.toString(), [viewsBalance.diagnostic]),
    viewsBurnRate.status === "success"
      ? createDerivedComparisonCheck(
          "burnRate",
          derivedBurnRate.value.toString(),
          viewsBurnRate.value.toString(),
          derivedBurnRate.value === viewsBurnRate.value,
          `Derived burn rate matched pinned Views at block ${verificationBlockNumber.toString()}`,
          `Derived burn rate did not match pinned Views at block ${verificationBlockNumber.toString()}`,
        )
      : createViewsReadFailedCheck("burnRate", derivedBurnRate.value.toString(), [viewsBurnRate.diagnostic]),
    isSuccessfulViewsRead(viewsBurnRate)
      && isSuccessfulViewsRead(viewsLiquidationThreshold)
      && isSuccessfulViewsRead(viewsMinimumCollateral)
      ? (() => {
          const viewsLiquidationCollateral = deriveLiquidationCollateral(viewsBurnRate.value, {
            liquidationThreshold: viewsLiquidationThreshold.value,
            minimumLiquidationCollateral: viewsMinimumCollateral.value,
          });

          return createDerivedComparisonCheck(
            "liquidationCollateral",
            derivedLiquidationCollateral.value.toString(),
            viewsLiquidationCollateral.value.toString(),
            derivedLiquidationCollateral.value === viewsLiquidationCollateral.value,
            `Derived liquidation collateral matched pinned Views inputs at block ${verificationBlockNumber.toString()}`,
            `Derived liquidation collateral did not match pinned Views inputs at block ${verificationBlockNumber.toString()}`,
          );
        })()
      : createViewsReadFailedCheck(
          "liquidationCollateral",
          derivedLiquidationCollateral.value.toString(),
          liquidationDiagnostics,
        ),
    viewsLiquidatable.status === "success"
      ? createDerivedComparisonCheck(
          "liquidatable",
          String(expectedLiquidatable.value),
          String(viewsLiquidatable.value),
          expectedLiquidatable.value === viewsLiquidatable.value,
          `Derived liquidatable status matched pinned Views at block ${verificationBlockNumber.toString()} (balance=${derivedBalance.value.toString()}, collateral=${derivedLiquidationCollateral.value.toString()})`,
          `Derived liquidatable status did not match pinned Views at block ${verificationBlockNumber.toString()} (balance=${derivedBalance.value.toString()}, collateral=${derivedLiquidationCollateral.value.toString()})`,
        )
      : createViewsReadFailedCheck("liquidatable", String(expectedLiquidatable.value), [viewsLiquidatable.diagnostic]),
    createSubgraphLagCheck(freshness),
  ];

  return {
    checks,
    accountingDebug: summarizeAccountingDebug(checks, accountingDebug),
  };
}

function hexToBigInt(value: string): bigint {
  return BigInt(value);
}

function createAssetTypeCheck(subgraphAsset: FeeAsset, onChainAsset: FeeAsset): ClusterIdentityCheckResult {
  const status: CheckStatus = subgraphAsset === onChainAsset ? "pass" : "fail";

  return withCheckContract({
    name: "assetType",
    status,
    reason: status === "pass" ? "matched" : "mismatch",
    classification: status === "pass" ? "verified" : "mismatch",
    subgraphValue: subgraphAsset,
    viewsValue: onChainAsset,
    detail: status === "pass"
      ? `Subgraph asset type matched the on-chain ${onChainAsset} Views surface`
      : `Subgraph asset type did not match the on-chain ${onChainAsset} Views surface`,
  });
}

function isFeeAsset(value: string | null): value is FeeAsset {
  return value === "ETH" || value === "SSV";
}

function formatFeeAsset(value: string | null): string {
  return value ?? "missing";
}

function clusterChecksForAsset(
  asset: FeeAsset | null,
  emptyCluster = false,
): ClusterIdentityCheckResult["name"][] {
  const checkNames: ClusterIdentityCheckResult["name"][] = [
    "assetType",
    "daoData",
    "currentBalance",
    "burnRate",
    "liquidationCollateral",
    "liquidatable",
  ];

  if (!emptyCluster) {
    checkNames.splice(2, 0, "operatorData");
  }

  if (asset === "ETH" && !emptyCluster) {
    checkNames.splice(3, 0, "effectiveBalance");
  }

  return checkNames;
}

function createBlockedClusterChecks(
  asset: FeeAsset | null,
  detail: string,
  blockedBy: ClusterIdentityCheckResult["name"],
  emptyCluster = false,
): ClusterIdentityCheckResult[] {
  return clusterChecksForAsset(asset, emptyCluster)
    .map((name) => createBlockedCheck(name, detail, blockedBy));
}

function createPassCheck(
  name: ClusterIdentityCheckResult["name"],
  subgraphValue: string,
  detail: string,
  viewsValue?: string,
): ClusterIdentityCheckResult {
  return withCheckContract({
    name,
    status: "pass",
    reason: "matched",
    classification: "verified",
    subgraphValue,
    detail,
    ...(viewsValue ? { viewsValue } : {}),
  });
}

function createBlockedDerivedChecks(
  detail: string,
  blockedBy: ClusterIdentityCheckResult["name"][],
): ClusterIdentityCheckResult[] {
  return (["currentBalance", "burnRate", "liquidationCollateral", "liquidatable"] as const).map((name) =>
    createInconclusiveCheck(name, "blocked", detail, blockedBy)
  );
}

function isEmptyCluster(cluster: Pick<NormalizedCluster, "validatorCount">): boolean {
  return cluster.validatorCount === 0;
}

function isPresentCheck(check: ClusterIdentityCheckResult | null): check is ClusterIdentityCheckResult {
  return check !== null;
}

function isSuccessfulViewsRead<T>(result: SettledViewsRead<T>): result is { status: "success"; value: T } {
  return result.status === "success";
}

async function settleViewsRead<T>(
  read: ViewsReadFailureDiagnostic["read"],
  blockTag: string,
  reader: Promise<T>,
): Promise<SettledViewsRead<T>> {
  try {
    return {
      status: "success",
      value: await reader,
    };
  } catch (error) {
    return {
      status: "failed",
      diagnostic: {
        kind: "viewsReadFailed",
        read,
        blockTag,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function collectViewsReadDiagnostics(
  results: ReadonlyArray<SettledViewsRead<unknown>>,
): ViewsReadFailureDiagnostic[] {
  return results.flatMap((result) => result.status === "failed" ? [result.diagnostic] : []);
}

function createViewsReadFailedCheck(
  name: ClusterIdentityCheckResult["name"],
  subgraphValue: string,
  diagnostics: ViewsReadFailureDiagnostic[],
): ClusterIdentityCheckResult {
  const diagnosticSummary = diagnostics.map((diagnostic) => `${diagnostic.read}: ${diagnostic.message}`).join("; ");

  return createInconclusiveCheck(
    name,
    subgraphValue,
    `Unable to read pinned Views inputs for ${name}: ${diagnosticSummary}`,
    undefined,
    diagnostics,
  );
}

function createDerivedComparisonCheck(
  name: Extract<ClusterIdentityCheckResult["name"], "currentBalance" | "burnRate" | "liquidationCollateral" | "liquidatable">,
  subgraphValue: string,
  viewsValue: string,
  matches: boolean,
  passDetail: string,
  failDetail: string,
): ClusterIdentityCheckResult {
  return withCheckContract({
    name,
    status: matches ? "pass" : "fail",
    reason: matches ? "matched" : "mismatch",
    classification: matches ? "verified" : "mismatch",
    subgraphValue,
    viewsValue,
    detail: matches ? passDetail : failDetail,
  });
}

function parseUnsignedDecimalValue(value: string): bigint | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  return BigInt(value);
}

function operatorAccountingFieldNames(asset: FeeAsset): Array<keyof NormalizedOperator> {
  return asset === "ETH"
    ? ["fee", "feeIndex", "feeIndexBlockNumber"]
    : ["feeSSV", "feeIndexSSV", "feeIndexBlockNumberSSV"];
}

function daoAccountingFieldNames(asset: FeeAsset): Array<keyof NormalizedDaoValues> {
  return asset === "ETH"
    ? ["networkFee", "networkFeeIndex", "networkFeeIndexBlockNumber", "liquidationThreshold", "minimumLiquidationCollateral"]
    : ["networkFeeSSV", "networkFeeIndexSSV", "networkFeeIndexBlockNumberSSV", "liquidationThresholdSSV", "minimumLiquidationCollateralSSV"];
}

function validateSelectedOperatorData(
  asset: FeeAsset,
  operators: ReadonlyArray<{
    id: string;
    fee?: string | null;
    feeIndex?: string | null;
    feeIndexBlockNumber?: string | null;
    feeSSV?: string | null;
    feeIndexSSV?: string | null;
    feeIndexBlockNumberSSV?: string | null;
  }>,
  expectedOperatorIds: bigint[],
): ClusterIdentityCheckResult {
  const operatorsById = new Map(operators.map((operator) => [operator.id, operator]));
  const missingInputs: string[] = [];
  const invalidInputs: string[] = [];

  for (const operatorId of expectedOperatorIds) {
    const operator = operatorsById.get(operatorId.toString());

    if (!operator) {
      missingInputs.push(`operator ${operatorId.toString()} record`);
      continue;
    }

    for (const fieldName of operatorAccountingFieldNames(asset)) {
      const rawValue = operator[fieldName];

      if (rawValue === undefined || rawValue === null) {
        missingInputs.push(`operator ${operatorId.toString()} ${fieldName}`);
        continue;
      }

      if (parseUnsignedDecimalValue(rawValue) === null) {
        invalidInputs.push(`operator ${operatorId.toString()} ${fieldName}=${rawValue}`);
      }
    }
  }

  if (missingInputs.length > 0) {
    return createInconclusiveCheck(
      "operatorData",
      asset,
      `Selected ${asset} operator accounting inputs were missing: ${missingInputs.join(", ")}`,
    );
  }

  if (invalidInputs.length > 0) {
    return createFailureCheck(
      "operatorData",
      asset,
      `Selected ${asset} operator accounting inputs were invalid: ${invalidInputs.join(", ")}`,
    );
  }

  return createPassCheck(
    "operatorData",
    asset,
    `Selected ${asset} operator accounting inputs were present for ${expectedOperatorIds.length.toString()} operators`,
  );
}

function validateSelectedDaoData(
  asset: FeeAsset,
  daoValues:
    | {
        networkFee?: string | null;
        networkFeeIndex?: string | null;
        networkFeeIndexBlockNumber?: string | null;
        liquidationThreshold?: string | null;
        minimumLiquidationCollateral?: string | null;
        networkFeeSSV?: string | null;
        networkFeeIndexSSV?: string | null;
        networkFeeIndexBlockNumberSSV?: string | null;
        liquidationThresholdSSV?: string | null;
        minimumLiquidationCollateralSSV?: string | null;
      }
    | null,
): ClusterIdentityCheckResult {
  if (!daoValues) {
    return createFailureCheck(
      "daoData",
      asset,
      `Selected ${asset} DAO accounting inputs were missing for the requested network`,
    );
  }

  const missingInputs: string[] = [];
  const invalidInputs: string[] = [];

  for (const fieldName of daoAccountingFieldNames(asset)) {
    const rawValue = daoValues[fieldName];

    if (rawValue === undefined || rawValue === null) {
      missingInputs.push(fieldName);
      continue;
    }

    if (parseUnsignedDecimalValue(rawValue) === null) {
      invalidInputs.push(`${fieldName}=${rawValue}`);
    }
  }

  if (missingInputs.length > 0) {
    return createFailureCheck(
      "daoData",
      asset,
      `Selected ${asset} DAO accounting inputs were missing: ${missingInputs.join(", ")}`,
    );
  }

  if (invalidInputs.length > 0) {
    return createFailureCheck(
      "daoData",
      asset,
      `Selected ${asset} DAO accounting inputs were invalid: ${invalidInputs.join(", ")}`,
    );
  }

  return createPassCheck(
    "daoData",
    asset,
    `Selected ${asset} DAO accounting inputs were present`,
  );
}

function buildBlockedClusterResult(
  network: SingleNetwork,
  clusterId: string,
  subgraphSource: "primary" | "fallback",
  freshness: SubgraphFreshness,
  clusterStateCheck: ClusterIdentityCheckResult,
  asset: FeeAsset | null,
  emptyCluster = false,
): VerifyClusterResult {
  const blockedChecks = clusterChecksForAsset(asset, emptyCluster)
    .map((name) => createBlockedCheck(name, `Skipped downstream cluster verification because clusterState was ${clusterStateCheck.status.toUpperCase()}`, "clusterState"));
  const checks = [clusterStateCheck, ...blockedChecks];

  return {
    network,
    clusterId,
    subgraphSource,
    freshness,
    status: summarizeStatus(checks),
    checks,
    accountingDebug: emptyAccountingDebug(clusterStateCheck.name),
  };
}

export async function verifyClusterIdentity(
  config: RuntimeConfig,
  clusterId: string,
  dependencies: VerifyClusterDependencies = {},
  reporter?: ProgressReporter,
): Promise<VerifyClusterResult> {
  const spinner = reporter?.spinner(`Verifying cluster ${clusterId}…`);
  try {
    const result = await runClusterIdentityVerification(config, clusterId, dependencies, spinner);
    if (result.status === "pass") {
      spinner?.succeed(`Cluster ${clusterId} verified (PASS)`);
    } else if (result.status === "fail") {
      spinner?.fail(`Cluster ${clusterId} FAILED verification`);
    } else {
      spinner?.stop();
    }
    return result;
  } catch (error) {
    spinner?.fail(`Failed to verify cluster ${clusterId}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

async function runClusterIdentityVerification(
  config: RuntimeConfig,
  clusterId: string,
  dependencies: VerifyClusterDependencies,
  spinner: import("../ui/progress.js").Spinner | undefined,
): Promise<VerifyClusterResult> {
  if (config.activeNetworks.length !== 1) {
    throw new Error("verify-cluster requires a single network target, not --network both.");
  }

  const fetchFn = dependencies.fetchFn ?? fetch;
  const network = config.activeNetworks[0]!;
  const networkConfig = config.networks[network];
  const rpcClient = createNetworkRpcPool(config, networkConfig, fetchFn);
  const parsedClusterId = (() => {
    try {
      return parseClusterId(clusterId);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  })();
  const chainHeadBlockPromise = rpcClient.call<string>("eth_blockNumber", []).then(hexToBigInt);
  if (parsedClusterId instanceof Error) {
    const chainHeadBlock = await chainHeadBlockPromise;
    const freshness = createFreshness(0n, chainHeadBlock);

    return buildBlockedClusterResult(
      network,
      clusterId,
      "primary",
      freshness,
      createFailureCheck("clusterState", clusterId, `Cluster ID could not be parsed into a usable cluster state: ${parsedClusterId.message}`),
      null,
    );
  }

  spinner?.update(`Fetching subgraph snapshot for cluster ${clusterId}…`);
  const subgraphAccounting = await fetchPinnedSubgraphClusterSnapshot(
    networkConfig.subgraphPrimaryUrl,
    networkConfig.subgraphFallbackUrl,
    clusterId,
    networkConfig.daoAddress,
    fetchFn,
  );

  if (subgraphAccounting.status === "query-failed") {
    const chainHeadBlock = await chainHeadBlockPromise;
    const freshness = createFreshness(0n, chainHeadBlock);

    return buildBlockedClusterResult(
      network,
      clusterId,
      subgraphAccounting.source,
      freshness,
      createInconclusiveCheck(
        "clusterState",
        clusterId,
        `Unable to fetch a usable pinned cluster snapshot: ${subgraphAccounting.detail}`,
      ),
      null,
    );
  }

  if (subgraphAccounting.status === "not-found") {
    const chainHeadBlock = await chainHeadBlockPromise;
    const freshness = createFreshness(BigInt(subgraphAccounting.indexedBlockNumber), chainHeadBlock);

    return buildBlockedClusterResult(
      network,
      clusterId,
      subgraphAccounting.source,
      freshness,
      createFailureCheck(
        "clusterState",
        clusterId,
        `Cluster ${clusterId} was not found in the subgraph at block ${subgraphAccounting.indexedBlockNumber}`,
      ),
      null,
    );
  }

  const cluster = normalizeClusterValue(subgraphAccounting.cluster);
  const chainHeadBlock = await chainHeadBlockPromise;
  const freshness = createFreshness(BigInt(subgraphAccounting.indexedBlockNumber), chainHeadBlock);
  const clusterAsset = isFeeAsset(cluster.feeAsset) ? cluster.feeAsset : null;
  const emptyCluster = isEmptyCluster(cluster);
  const fetchedClusterId = (() => {
    try {
      return parseClusterId(subgraphAccounting.cluster.id);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  })();

  if (fetchedClusterId instanceof Error) {
    return buildBlockedClusterResult(
      network,
      clusterId,
      subgraphAccounting.source,
      freshness,
      createFailureCheck("clusterState", subgraphAccounting.cluster.id, `Fetched cluster id was not canonical: ${fetchedClusterId.message}`),
      clusterAsset,
      emptyCluster,
    );
  }

  if (fetchedClusterId.canonicalId !== parsedClusterId.canonicalId) {
    return buildBlockedClusterResult(
      network,
      subgraphAccounting.cluster.id,
      subgraphAccounting.source,
      freshness,
      createFailureCheck(
        "clusterState",
        subgraphAccounting.cluster.id,
        `Fetched cluster id ${subgraphAccounting.cluster.id} did not match the requested cluster ${parsedClusterId.canonicalId}`,
        parsedClusterId.canonicalId,
      ),
      clusterAsset,
      emptyCluster,
    );
  }

  if (cluster.owner !== fetchedClusterId.ownerAddress) {
    return buildBlockedClusterResult(
      network,
      cluster.id,
      subgraphAccounting.source,
      freshness,
      createFailureCheck(
        "clusterState",
        cluster.owner,
        "Fetched cluster owner did not match the owner encoded in the cluster id",
        fetchedClusterId.ownerAddress,
      ),
      clusterAsset,
      emptyCluster,
    );
  }

  if (formatOperatorIds(cluster.operatorIds) !== formatOperatorIds(fetchedClusterId.operatorIds)) {
    return buildBlockedClusterResult(
      network,
      cluster.id,
      subgraphAccounting.source,
      freshness,
      createFailureCheck(
        "clusterState",
        formatOperatorIds(cluster.operatorIds),
        "Fetched cluster operatorIds did not match the operator set encoded in the cluster id",
        formatOperatorIds(fetchedClusterId.operatorIds),
      ),
      clusterAsset,
      emptyCluster,
    );
  }

  spinner?.update(`Reading on-chain state for cluster ${clusterId}…`);
  const views = createViewsAdapter(rpcClient, networkConfig.viewsAddress);
  const verificationBlockNumber = BigInt(subgraphAccounting.indexedBlockNumber);
  const verificationBlockTag = `0x${verificationBlockNumber.toString(16)}`;
  const onChainAsset = await views.getClusterAssetType(cluster.owner, cluster.operatorIds, verificationBlockTag);
  const subgraphAsset = clusterAsset;
  const assetTypeCheck = onChainAsset.status === "revert"
    ? createInconclusiveCheck(
        "assetType",
        formatFeeAsset(cluster.feeAsset),
        `Unable to read the on-chain cluster asset type at block ${subgraphAccounting.indexedBlockNumber}: ${onChainAsset.detail}`,
      )
    : !subgraphAsset
      ? createFailureCheck(
          "assetType",
          formatFeeAsset(cluster.feeAsset),
          `Subgraph cluster feeAsset must be ETH or SSV; received ${formatFeeAsset(cluster.feeAsset)}`,
          onChainAsset.asset ?? `unknown(${onChainAsset.rawVersion?.toString() ?? "missing"})`,
        )
      : !onChainAsset.asset
        ? createFailureCheck(
            "assetType",
            subgraphAsset,
            onChainAsset.detail,
            `unknown(${onChainAsset.rawVersion?.toString() ?? "missing"})`,
          )
        : createAssetTypeCheck(subgraphAsset, onChainAsset.asset);
  const blockedChecks = createBlockedClusterChecks(
    subgraphAsset,
    `Skipped downstream cluster verification because assetType was ${assetTypeCheck.status.toUpperCase()}`,
    "assetType",
    emptyCluster,
  );

  const verification = assetTypeCheck.status !== "pass"
    ? {
        checks: [
          createPassCheck("clusterState", cluster.id, "Pinned subgraph cluster snapshot was usable for verification"),
          assetTypeCheck,
          ...blockedChecks.filter((check) => check.name !== "assetType"),
        ],
        accountingDebug: emptyAccountingDebug("assetType"),
      }
    : await (() => {
        const validationAsset: FeeAsset = subgraphAsset!;
        const baselinePromise = views.validateClusterState(validationAsset, cluster.owner, cluster.operatorIds, toViewsClusterState(cluster));
        return baselinePromise.then((baseline) => {
          const clusterStateCheck = baseline.status === "revert"
            ? createFailureCheck(
                "clusterState",
                cluster.id,
                `Views rejected the subgraph cluster state on the ${validationAsset} surface: ${baseline.detail}`,
              )
            : createPassCheck(
                "clusterState",
                cluster.id,
                `Pinned subgraph cluster snapshot was usable on the ${validationAsset} Views surface`,
              );

          if (baseline.status === "revert") {
            return {
              checks: [
                clusterStateCheck,
                assetTypeCheck,
                ...createBlockedClusterChecks(
                  validationAsset,
                  `Skipped downstream cluster verification because clusterState was ${clusterStateCheck.status.toUpperCase()}`,
                  "clusterState",
                  emptyCluster,
                ).filter((check) => check.name !== "assetType"),
              ],
              accountingDebug: emptyAccountingDebug("clusterState"),
            };
          }

          const baseChecks = [clusterStateCheck, assetTypeCheck];
          const daoDataCheck = validateSelectedDaoData(validationAsset, subgraphAccounting.daoValues);
          const operatorDataCheck = emptyCluster
            ? null
            : validateSelectedOperatorData(validationAsset, subgraphAccounting.operators, cluster.operatorIds);
          const blockedInputChecks = [daoDataCheck, operatorDataCheck]
            .filter(isPresentCheck)
            .filter((check) => check.status !== "pass");
          const derivedBlockerDetail = blockedInputChecks.length === 1
            ? `Skipped derived cluster verification because ${blockedInputChecks[0]!.name} was ${blockedInputChecks[0]!.status.toUpperCase()}`
            : `Skipped derived cluster verification because ${blockedInputChecks.map((check) => `${check.name} was ${check.status.toUpperCase()}`).join(" and ")}`;

          if (validationAsset === "ETH") {
            const effectiveBalanceCheck = emptyCluster
              ? null
              : cluster.effectiveBalance !== null
              && cluster.effectiveBalance > 0n
              ? createPassCheck(
                  "effectiveBalance",
                  cluster.effectiveBalance.toString(),
                  `ETH effective balance was present and produced scale ${(cluster.effectiveBalance / 32n).toString()}`,
                )
              : createFailureCheck(
                  "effectiveBalance",
                  cluster.effectiveBalance?.toString() ?? "missing",
                  "ETH effective balance must be present and greater than zero",
                );

            if (blockedInputChecks.length > 0) {
              const checks = [
                ...baseChecks,
                daoDataCheck,
                ...[operatorDataCheck, effectiveBalanceCheck].filter(isPresentCheck),
                ...createBlockedDerivedChecks(
                  derivedBlockerDetail,
                  blockedInputChecks.map((check) => check.name),
                ),
              ];

              return {
                checks,
                accountingDebug: summarizeAccountingDebug(checks, {
                  selectedAsset: validationAsset,
                  localInputs: {
                    cluster: {
                      validatorCount: cluster.validatorCount,
                      networkFeeIndex: cluster.networkFeeIndex,
                      index: cluster.index,
                      active: cluster.active,
                      balance: cluster.balance,
                      effectiveBalance: cluster.effectiveBalance,
                    },
                  },
                }),
              };
            }

            if (effectiveBalanceCheck && effectiveBalanceCheck.status !== "pass") {
              const checks = [
                ...baseChecks,
                daoDataCheck,
                ...[operatorDataCheck].filter(isPresentCheck),
                effectiveBalanceCheck,
                ...createBlockedDerivedChecks(
                  `Skipped derived cluster verification because effectiveBalance was ${effectiveBalanceCheck.status.toUpperCase()}`,
                  ["effectiveBalance"],
                ),
              ];

              return {
                checks,
                accountingDebug: summarizeAccountingDebug(checks, {
                  selectedAsset: validationAsset,
                  localInputs: {
                    cluster: {
                      validatorCount: cluster.validatorCount,
                      networkFeeIndex: cluster.networkFeeIndex,
                      index: cluster.index,
                      active: cluster.active,
                      balance: cluster.balance,
                      effectiveBalance: cluster.effectiveBalance,
                    },
                  },
                }),
              };
            }

            const operators = subgraphAccounting.operators.map(normalizeOperatorValue);
            const daoValues = normalizeDaoValues(subgraphAccounting.daoValues!);
            const selectedOperators = emptyCluster ? [] : selectOperatorAccounting(validationAsset, operators);
            const selectedDaoValues = selectDaoAccounting(validationAsset, daoValues);

            return buildPinnedDerivedChecks({
              views,
              asset: validationAsset,
              cluster,
              operators: selectedOperators,
              daoValues: selectedDaoValues,
              baseChecks,
              inputChecks: [daoDataCheck, operatorDataCheck, effectiveBalanceCheck].filter(isPresentCheck),
              verificationBlockNumber,
              verificationBlockTag,
              freshness,
            });
          }

          if (blockedInputChecks.length > 0) {
            const checks = [
              ...baseChecks,
              daoDataCheck,
              operatorDataCheck,
              ...createBlockedDerivedChecks(
                derivedBlockerDetail,
                blockedInputChecks.map((check) => check.name),
              ),
            ].filter(isPresentCheck);

            return {
              checks,
              accountingDebug: summarizeAccountingDebug(checks, {
                selectedAsset: validationAsset,
                localInputs: {
                  cluster: {
                    validatorCount: cluster.validatorCount,
                    networkFeeIndex: cluster.networkFeeIndex,
                    index: cluster.index,
                    active: cluster.active,
                    balance: cluster.balance,
                    effectiveBalance: cluster.effectiveBalance,
                  },
                },
              }),
            };
          }

          const operators = subgraphAccounting.operators.map(normalizeOperatorValue);
          const daoValues = normalizeDaoValues(subgraphAccounting.daoValues!);
          const selectedOperators = emptyCluster ? [] : selectOperatorAccounting(validationAsset, operators);
          const selectedDaoValues = selectDaoAccounting(validationAsset, daoValues);

          return buildPinnedDerivedChecks({
            views,
            asset: validationAsset,
            cluster,
            operators: selectedOperators,
            daoValues: selectedDaoValues,
            baseChecks,
            inputChecks: [daoDataCheck, operatorDataCheck].filter(isPresentCheck),
            verificationBlockNumber,
            verificationBlockTag,
            freshness,
          });
        });
      })();

  const classifiedChecks = verification.checks.filter(isPresentCheck);

  return {
    network,
    clusterId: cluster.id,
    subgraphSource: subgraphAccounting.source,
    freshness,
    status: summarizeStatus(classifiedChecks),
    checks: classifiedChecks,
    accountingDebug: summarizeAccountingDebug(classifiedChecks, verification.accountingDebug),
  };
}

function renderCheckValueFragment(check: ClusterIdentityCheckResult): string {
  if (check.reason === "blocked") {
    return "";
  }

  const localValue = check.subgraphValue !== "blocked" ? ` local=${check.subgraphValue}` : "";
  const viewsValue = check.viewsValue !== undefined ? ` views=${check.viewsValue}` : "";

  return `${localValue}${viewsValue}`;
}

export function renderVerifyClusterSummary(result: VerifyClusterResult): string {
  const lines = [
    `verify-cluster ${result.status.toUpperCase()}`,
    `network: ${result.network}`,
    `cluster: ${result.clusterId}`,
    `subgraph source: ${result.subgraphSource}`,
    `verification block: ${result.freshness.indexedBlockNumber}`,
    `chain head: ${result.freshness.chainHeadBlockNumber}`,
    `subgraph lag: ${result.freshness.lagBlocks} block(s) (${result.freshness.status})`,
    "checks:",
  ];

  for (const check of result.checks) {
    const blockedBy = check.blockedBy?.length ? ` blockedBy=${check.blockedBy.join(",")}` : "";
    const values = renderCheckValueFragment(check);
    lines.push(
      `- ${check.name}: ${check.status.toUpperCase()} kind=${check.kind} reason=${check.reason}${blockedBy}${values} detail="${check.detail}"`,
    );
  }

  return lines.join("\n");
}

export function jsonScalar(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(jsonScalar);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nestedValue]) => nestedValue !== undefined && nestedValue !== null)
        .map(([key, nestedValue]) => [key, jsonScalar(nestedValue)]),
    );
  }

  return value;
}

export function toPublicVerifyClusterJson(result: VerifyClusterResult): Record<string, unknown> {
  return {
    network: result.network,
    clusterId: result.clusterId,
    subgraphSource: result.subgraphSource,
    verificationBlock: result.freshness.indexedBlockNumber,
    status: result.status,
    checks: result.checks.map((check) => ({
      name: check.name,
      kind: check.kind,
      status: check.status,
      reason: check.reason,
      detail: check.detail,
      ...(check.subgraphValue !== "blocked" ? { localValue: check.subgraphValue } : {}),
      ...(check.viewsValue !== undefined ? { viewsValue: check.viewsValue } : {}),
      ...(check.blockedBy?.length ? { blockedBy: check.blockedBy } : {}),
      ...(check.diagnostics?.length ? { diagnostics: check.diagnostics } : {}),
    })),
    accountingDebug: jsonScalar(result.accountingDebug),
  };
}

export function renderVerifyClusterJson(result: VerifyClusterResult): string {
  return JSON.stringify(toPublicVerifyClusterJson(result), null, 2);
}
