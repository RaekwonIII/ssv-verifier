import type { RuntimeConfig } from "../config/env.js";
import type { SingleNetwork } from "../config/networks.js";
import { jsonRpcRequest } from "../clients/json-rpc.js";
import { fetchPinnedSubgraphClusterSnapshot } from "../clients/subgraph.js";
import { parseClusterId } from "../domain/cluster-id.js";
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
    | "clusterState"
    | "assetType"
    | "daoData"
    | "operatorData"
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
  blockedBy?: string[];
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
  blockedBy?: string[],
): ClusterIdentityCheckResult {
  return {
    name,
    status: "inconclusive",
    classification: "inconclusive",
    subgraphValue,
    detail,
    ...(blockedBy ? { blockedBy } : {}),
  };
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

    if (!["currentBalance", "burnRate", "liquidationCollateral", "liquidatable"].includes(check.name)) {
      return {
        ...check,
        classification: check.status === "pass" ? "verified" : "mismatch",
      };
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

function clusterScale(cluster: Pick<DerivedClusterAccountingInputs, "feeAsset" | "effectiveBalance" | "validatorCount">): bigint {
  return cluster.feeAsset === "ETH"
    ? (cluster.effectiveBalance ?? 0n) / 32n
    : BigInt(cluster.validatorCount);
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

export function deriveCurrentClusterBalance(
  cluster: DerivedClusterAccountingInputs,
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
  cluster: Pick<DerivedClusterAccountingInputs, "feeAsset" | "effectiveBalance" | "validatorCount">,
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

function isFeeAsset(value: string | null): value is FeeAsset {
  return value === "ETH" || value === "SSV";
}

function formatFeeAsset(value: string | null): string {
  return value ?? "missing";
}

function createBlockedAccountingChecks(
  detail: string,
  blockedBy: ClusterIdentityCheckResult["name"],
): ClusterIdentityCheckResult[] {
  return [
    createBlockedCheck("assetType", detail, blockedBy),
    createBlockedCheck("daoData", detail, blockedBy),
    createBlockedCheck("operatorData", detail, blockedBy),
    createBlockedCheck("owner", detail, blockedBy),
    createBlockedCheck("operatorIds", detail, blockedBy),
    createBlockedCheck("validatorCount", detail, blockedBy),
    createBlockedCheck("active", detail, blockedBy),
    createBlockedCheck("currentBalance", detail, blockedBy),
    createBlockedCheck("burnRate", detail, blockedBy),
    createBlockedCheck("liquidationCollateral", detail, blockedBy),
    createBlockedCheck("liquidatable", detail, blockedBy),
  ];
}

function createBlockedEthAccountingChecks(
  detail: string,
  blockedBy: ClusterIdentityCheckResult["name"],
): ClusterIdentityCheckResult[] {
  return [
    createBlockedCheck("assetType", detail, blockedBy),
    createBlockedCheck("daoData", detail, blockedBy),
    createBlockedCheck("operatorData", detail, blockedBy),
    createBlockedCheck("owner", detail, blockedBy),
    createBlockedCheck("operatorIds", detail, blockedBy),
    createBlockedCheck("validatorCount", detail, blockedBy),
    createBlockedCheck("active", detail, blockedBy),
    createBlockedCheck("effectiveBalance", detail, blockedBy),
    createBlockedCheck("currentBalance", detail, blockedBy),
    createBlockedCheck("burnRate", detail, blockedBy),
    createBlockedCheck("liquidationCollateral", detail, blockedBy),
    createBlockedCheck("liquidatable", detail, blockedBy),
  ];
}

function clusterChecksForAsset(asset: FeeAsset | null): ClusterIdentityCheckResult["name"][] {
  return asset === "ETH"
    ? ["assetType", "daoData", "operatorData", "owner", "operatorIds", "validatorCount", "active", "effectiveBalance", "currentBalance", "burnRate", "liquidationCollateral", "liquidatable"]
    : ["assetType", "daoData", "operatorData", "owner", "operatorIds", "validatorCount", "active", "currentBalance", "burnRate", "liquidationCollateral", "liquidatable"];
}

function createPassCheck(
  name: ClusterIdentityCheckResult["name"],
  subgraphValue: string,
  detail: string,
  viewsValue?: string,
): ClusterIdentityCheckResult {
  return {
    name,
    status: "pass",
    classification: "verified",
    subgraphValue,
    detail,
    ...(viewsValue ? { viewsValue } : {}),
  };
}

function createBlockedDerivedChecks(
  detail: string,
  blockedBy: ClusterIdentityCheckResult["name"][],
): ClusterIdentityCheckResult[] {
  return (["currentBalance", "burnRate", "liquidationCollateral", "liquidatable"] as const).map((name) =>
    createInconclusiveCheck(name, "blocked", detail, blockedBy)
  );
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
): VerifyClusterResult {
  const blockedChecks = clusterChecksForAsset(asset)
    .map((name) => createBlockedCheck(name, `Skipped downstream cluster verification because clusterState was ${clusterStateCheck.status.toUpperCase()}`, "clusterState"));
  const checks = [clusterStateCheck, ...blockedChecks];

  return {
    network,
    clusterId,
    subgraphSource,
    freshness,
    status: summarizeStatus(checks),
    checks,
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
  const parsedClusterId = (() => {
    try {
      return parseClusterId(clusterId);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  })();
  const chainHeadBlockPromise = jsonRpcRequest<string>(
    networkConfig.rpcUrl,
    "eth_blockNumber",
    [],
    fetchFn,
  ).then(hexToBigInt);
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
    );
  }

  const views = createViewsAdapter(networkConfig.rpcUrl, networkConfig.viewsAddress, fetchFn);
  const verificationBlockTag = `0x${BigInt(subgraphAccounting.indexedBlockNumber).toString(16)}`;
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
  const blockedChecks = subgraphAsset === "ETH"
    ? createBlockedEthAccountingChecks(
        `Skipped downstream cluster verification because assetType was ${assetTypeCheck.status.toUpperCase()}`,
        "assetType",
      )
    : createBlockedAccountingChecks(
        `Skipped downstream cluster verification because assetType was ${assetTypeCheck.status.toUpperCase()}`,
        "assetType",
      );

  const checks = assetTypeCheck.status !== "pass"
    ? [
        createPassCheck("clusterState", cluster.id, "Pinned subgraph cluster snapshot was usable for verification"),
        assetTypeCheck,
        ...blockedChecks.filter((check) => check.name !== "assetType"),
      ]
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
            return [
              assetTypeCheck,
              clusterStateCheck,
              ...(validationAsset === "ETH"
                ? createBlockedEthAccountingChecks(
                    `Skipped downstream cluster verification because clusterState was ${clusterStateCheck.status.toUpperCase()}`,
                    "clusterState",
                  )
                : createBlockedAccountingChecks(
                    `Skipped downstream cluster verification because clusterState was ${clusterStateCheck.status.toUpperCase()}`,
                    "clusterState",
                  )).filter((check) => check.name !== "assetType"),
            ];
          }

          const baseChecks = [assetTypeCheck, clusterStateCheck];
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
          const daoDataCheck = validateSelectedDaoData(validationAsset, subgraphAccounting.daoValues);
          const operatorDataCheck = validateSelectedOperatorData(validationAsset, subgraphAccounting.operators, cluster.operatorIds);
          const blockedInputChecks = [daoDataCheck, operatorDataCheck].filter((check) => check.status !== "pass");
          const derivedBlockerDetail = blockedInputChecks.length === 1
            ? `Skipped derived cluster verification because ${blockedInputChecks[0]!.name} was ${blockedInputChecks[0]!.status.toUpperCase()}`
            : `Skipped derived cluster verification because ${blockedInputChecks.map((check) => `${check.name} was ${check.status.toUpperCase()}`).join(" and ")}`;

          if (validationAsset === "ETH") {
            const effectiveBalanceCheck = cluster.effectiveBalance !== null
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
              return identityChecksPromise.then((identityChecks) => [
                ...baseChecks,
                ...identityChecks,
                daoDataCheck,
                operatorDataCheck,
                effectiveBalanceCheck,
                ...createBlockedDerivedChecks(
                  derivedBlockerDetail,
                  blockedInputChecks.map((check) => check.name),
                ),
              ]);
            }

            if (effectiveBalanceCheck.status !== "pass") {
              return identityChecksPromise.then((identityChecks) => [
                ...baseChecks,
                ...identityChecks,
                daoDataCheck,
                operatorDataCheck,
                effectiveBalanceCheck,
                ...createBlockedDerivedChecks(
                  `Skipped derived cluster verification because effectiveBalance was ${effectiveBalanceCheck.status.toUpperCase()}`,
                  ["effectiveBalance"],
                ),
              ]);
            }

            const operators = subgraphAccounting.operators.map(normalizeOperatorValue);
            const daoValues = normalizeDaoValues(subgraphAccounting.daoValues!);
            const selectedOperators = selectOperatorAccounting(validationAsset, operators);
            const selectedDaoValues = selectDaoAccounting(validationAsset, daoValues);

            const viewsBalancePromise = views.getClusterBalance(validationAsset, cluster.owner, cluster.operatorIds, toViewsClusterState(cluster));
            const viewsBurnRatePromise = views.getClusterBurnRate(validationAsset, cluster.owner, cluster.operatorIds, toViewsClusterState(cluster));
            const viewsLiquidatablePromise = views.getClusterLiquidatable(validationAsset, cluster.owner, cluster.operatorIds, toViewsClusterState(cluster));
            const viewsLiquidationThresholdPromise = views.getLiquidationThreshold(validationAsset);
            const viewsMinimumCollateralPromise = views.getMinimumLiquidationCollateral(validationAsset);

            return Promise.all([
              identityChecksPromise,
              viewsBalancePromise,
              viewsBurnRatePromise,
              viewsLiquidatablePromise,
              viewsLiquidationThresholdPromise,
              viewsMinimumCollateralPromise,
            ]).then(([
              identityChecks,
              viewsBalance,
              viewsBurnRate,
              viewsLiquidatable,
              viewsLiquidationThreshold,
              viewsMinimumCollateral,
            ]) => {
              const derivedBalance = deriveCurrentClusterBalance({ ...cluster, feeAsset: validationAsset }, selectedOperators, selectedDaoValues, chainHeadBlock);
              const derivedBurnRate = deriveClusterBurnRate({ ...cluster, feeAsset: validationAsset }, selectedOperators, selectedDaoValues);
              const subgraphLiquidationCollateral = deriveLiquidationCollateral(derivedBurnRate, selectedDaoValues);
              const viewsLiquidationCollateral = deriveLiquidationCollateral(viewsBurnRate, {
                liquidationThreshold: viewsLiquidationThreshold,
                minimumLiquidationCollateral: viewsMinimumCollateral,
              });
              const expectedLiquidatable = deriveLiquidatableStatus(cluster.active, derivedBalance, subgraphLiquidationCollateral);

              return [
                ...baseChecks,
                ...identityChecks,
                daoDataCheck,
                operatorDataCheck,
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
                {
                  name: "liquidationCollateral",
                  status: subgraphLiquidationCollateral === viewsLiquidationCollateral ? "pass" : "fail",
                  classification: subgraphLiquidationCollateral === viewsLiquidationCollateral ? "verified" : "mismatch",
                  subgraphValue: subgraphLiquidationCollateral.toString(),
                  viewsValue: viewsLiquidationCollateral.toString(),
                  detail: subgraphLiquidationCollateral === viewsLiquidationCollateral
                    ? "Derived liquidation collateral matched Views-side collateral inputs"
                    : "Derived liquidation collateral did not match Views-side collateral inputs",
                } satisfies ClusterIdentityCheckResult,
                {
                  name: "liquidatable",
                  status: expectedLiquidatable === viewsLiquidatable ? "pass" : "fail",
                  classification: expectedLiquidatable === viewsLiquidatable ? "verified" : "mismatch",
                  subgraphValue: String(expectedLiquidatable),
                  viewsValue: String(viewsLiquidatable),
                  detail: expectedLiquidatable === viewsLiquidatable
                    ? `Derived liquidatable status matched Views at block ${chainHeadBlock.toString()} (balance=${derivedBalance.toString()}, collateral=${subgraphLiquidationCollateral.toString()})`
                    : `Derived liquidatable status did not match Views at block ${chainHeadBlock.toString()} (balance=${derivedBalance.toString()}, collateral=${subgraphLiquidationCollateral.toString()})`,
                } satisfies ClusterIdentityCheckResult,
              ];
            });
          }

          if (blockedInputChecks.length > 0) {
            return identityChecksPromise.then((identityChecks) => [
              ...baseChecks,
              ...identityChecks,
              daoDataCheck,
              operatorDataCheck,
              ...createBlockedDerivedChecks(
                derivedBlockerDetail,
                blockedInputChecks.map((check) => check.name),
              ),
            ]);
          }

          const operators = subgraphAccounting.operators.map(normalizeOperatorValue);
          const daoValues = normalizeDaoValues(subgraphAccounting.daoValues!);
          const selectedOperators = selectOperatorAccounting(validationAsset, operators);
          const selectedDaoValues = selectDaoAccounting(validationAsset, daoValues);

          const viewsBalancePromise = views.getClusterBalance(validationAsset, cluster.owner, cluster.operatorIds, toViewsClusterState(cluster));
          const viewsBurnRatePromise = views.getClusterBurnRate(validationAsset, cluster.owner, cluster.operatorIds, toViewsClusterState(cluster));
          const viewsLiquidatablePromise = views.getClusterLiquidatable(validationAsset, cluster.owner, cluster.operatorIds, toViewsClusterState(cluster));
          const viewsLiquidationThresholdPromise = views.getLiquidationThreshold(validationAsset);
          const viewsMinimumCollateralPromise = views.getMinimumLiquidationCollateral(validationAsset);

          return Promise.all([
            identityChecksPromise,
            viewsBalancePromise,
            viewsBurnRatePromise,
            viewsLiquidatablePromise,
            viewsLiquidationThresholdPromise,
            viewsMinimumCollateralPromise,
          ]).then(([
            identityChecks,
            viewsBalance,
            viewsBurnRate,
            viewsLiquidatable,
            viewsLiquidationThreshold,
            viewsMinimumCollateral,
          ]) => {
            const derivedBalance = deriveCurrentClusterBalance({ ...cluster, feeAsset: validationAsset }, selectedOperators, selectedDaoValues, chainHeadBlock);
            const derivedBurnRate = deriveClusterBurnRate({ ...cluster, feeAsset: validationAsset }, selectedOperators, selectedDaoValues);
            const subgraphLiquidationCollateral = deriveLiquidationCollateral(derivedBurnRate, selectedDaoValues);
            const viewsLiquidationCollateral = deriveLiquidationCollateral(viewsBurnRate, {
              liquidationThreshold: viewsLiquidationThreshold,
              minimumLiquidationCollateral: viewsMinimumCollateral,
            });
            const expectedLiquidatable = deriveLiquidatableStatus(cluster.active, derivedBalance, subgraphLiquidationCollateral);

            return [
              ...baseChecks,
              ...identityChecks,
              daoDataCheck,
              operatorDataCheck,
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
                status: subgraphLiquidationCollateral === viewsLiquidationCollateral ? "pass" : "fail",
                classification: subgraphLiquidationCollateral === viewsLiquidationCollateral ? "verified" : "mismatch",
                subgraphValue: subgraphLiquidationCollateral.toString(),
                viewsValue: viewsLiquidationCollateral.toString(),
                detail: subgraphLiquidationCollateral === viewsLiquidationCollateral
                  ? "Derived liquidation collateral matched Views-side collateral inputs"
                  : "Derived liquidation collateral did not match Views-side collateral inputs",
              } satisfies ClusterIdentityCheckResult,
              {
                name: "liquidatable",
                status: expectedLiquidatable === viewsLiquidatable ? "pass" : "fail",
                classification: expectedLiquidatable === viewsLiquidatable ? "verified" : "mismatch",
                subgraphValue: String(expectedLiquidatable),
                viewsValue: String(viewsLiquidatable),
                detail: expectedLiquidatable === viewsLiquidatable
                  ? `Derived liquidatable status matched Views at block ${chainHeadBlock.toString()} (balance=${viewsBalance.toString()}, collateral=${subgraphLiquidationCollateral.toString()})`
                  : `Derived liquidatable status did not match Views at block ${chainHeadBlock.toString()} (balance=${viewsBalance.toString()}, collateral=${subgraphLiquidationCollateral.toString()})`,
              } satisfies ClusterIdentityCheckResult,
            ];
          });
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
    const blockedBy = check.blockedBy?.length ? `; blockedBy=${check.blockedBy.join(",")}` : "";
    lines.push(`- ${check.name}: ${check.status.toUpperCase()} [${check.classification}] (${values}; ${check.detail}${blockedBy})`);
  }

  return lines.join("\n");
}

export function renderVerifyClusterJson(result: VerifyClusterResult): string {
  return JSON.stringify(result, null, 2);
}
