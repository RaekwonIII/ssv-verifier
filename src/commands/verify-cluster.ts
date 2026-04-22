import type { RuntimeConfig } from "../config/env.js";
import type { SingleNetwork } from "../config/networks.js";
import { jsonRpcRequest } from "../clients/json-rpc.js";
import { fetchSubgraphClusterAccounting } from "../clients/subgraph.js";
import {
  getClusterBalanceFromViews,
  getClusterBurnRateFromViews,
  getClusterLiquidatableFromViews,
  validateClusterStateWithViews,
  type ViewsClusterState,
} from "../clients/views.js";

const LEGACY_SSV_PRECISION = 10_000_000n;

export type CheckStatus = "pass" | "warn" | "fail";

export interface SubgraphFreshness {
  indexedBlockNumber: number;
  chainHeadBlockNumber: number;
  lagBlocks: number;
  status: "fresh" | "lagging";
}

export type CheckClassification = "verified" | "mismatch" | "lag-affected";

export interface ClusterIdentityCheckResult {
  name:
    | "owner"
    | "operatorIds"
    | "validatorCount"
    | "active"
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
}

interface NormalizedDaoValues {
  networkFee: bigint;
  networkFeeIndex: bigint;
  networkFeeIndexBlockNumber: bigint;
  liquidationThreshold: bigint;
  minimumLiquidationCollateral: bigint;
}

function normalizeClusterValue(cluster: {
  id: string;
  owner: { id: string };
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
}): NormalizedOperator {
  return {
    id: BigInt(operator.id),
    fee: BigInt(operator.fee),
    feeIndex: BigInt(operator.feeIndex),
    feeIndexBlockNumber: BigInt(operator.feeIndexBlockNumber),
  };
}

function normalizeDaoValues(daoValues: {
  networkFee: string;
  networkFeeIndex: string;
  networkFeeIndexBlockNumber: string;
  liquidationThreshold: string;
  minimumLiquidationCollateral: string;
}): NormalizedDaoValues {
  return {
    networkFee: BigInt(daoValues.networkFee),
    networkFeeIndex: BigInt(daoValues.networkFeeIndex),
    networkFeeIndexBlockNumber: BigInt(daoValues.networkFeeIndexBlockNumber),
    liquidationThreshold: BigInt(daoValues.liquidationThreshold),
    minimumLiquidationCollateral: BigInt(daoValues.minimumLiquidationCollateral),
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
      classification: check.status === "pass" ? "verified" : "mismatch",
    }));
  }

  return checks.map((check) => {
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
  if (checks.some((check) => check.status === "fail")) {
    return "fail";
  }

  if (checks.some((check) => check.status === "warn")) {
    return "warn";
  }

  return "pass";
}

function currentIndex(baseIndex: bigint, fee: bigint, startBlock: bigint, currentBlock: bigint): bigint {
  return (baseIndex * LEGACY_SSV_PRECISION) + ((currentBlock - startBlock) * fee);
}

export function deriveCurrentClusterBalance(
  cluster: Pick<NormalizedCluster, "validatorCount" | "networkFeeIndex" | "index" | "balance">,
  operators: ReadonlyArray<Pick<NormalizedOperator, "fee" | "feeIndex" | "feeIndexBlockNumber">>,
  daoValues: Pick<NormalizedDaoValues, "networkFee" | "networkFeeIndex" | "networkFeeIndexBlockNumber">,
  currentBlock: bigint,
): bigint {
  const operatorIndexes = operators.reduce(
    (sum, operator) => sum + currentIndex(operator.feeIndex, operator.fee, operator.feeIndexBlockNumber, currentBlock),
    0n,
  );
  const networkIndex = currentIndex(
    daoValues.networkFeeIndex,
    daoValues.networkFee,
    daoValues.networkFeeIndexBlockNumber,
    currentBlock,
  );
  const totalCurrentIndexes = operatorIndexes + networkIndex;
  const totalClusterIndex =
    (cluster.index * LEGACY_SSV_PRECISION) + (cluster.networkFeeIndex * LEGACY_SSV_PRECISION);
  const indexDelta = totalCurrentIndexes - totalClusterIndex;
  const scale = BigInt(cluster.validatorCount);
  const currentBalance = cluster.balance - (indexDelta * scale);

  return currentBalance > 0n ? currentBalance : 0n;
}

export function deriveClusterBurnRate(
  validatorCount: number,
  operators: ReadonlyArray<Pick<NormalizedOperator, "fee">>,
  daoValues: Pick<NormalizedDaoValues, "networkFee">,
): bigint {
  const operatorFees = operators.reduce((sum, operator) => sum + operator.fee, 0n);
  return (operatorFees + daoValues.networkFee) * BigInt(validatorCount);
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
  const baseline = await validateClusterStateWithViews(
    networkConfig.rpcUrl,
    networkConfig.viewsAddress,
    cluster.owner,
    cluster.operatorIds,
    toViewsClusterState(cluster),
    fetchFn,
  );

  const baselineFailure = `Views rejected the subgraph cluster state: ${baseline.detail}`;

  const checks = baseline.status === "revert"
    ? [
        createFailureCheck("owner", cluster.owner, baselineFailure),
        createFailureCheck("operatorIds", formatOperatorIds(cluster.operatorIds), baselineFailure),
        createFailureCheck("validatorCount", String(cluster.validatorCount), baselineFailure),
        createFailureCheck("active", String(cluster.active), baselineFailure),
        createFailureCheck("currentBalance", cluster.balance.toString(), baselineFailure),
        createFailureCheck("burnRate", "unknown", baselineFailure),
        createFailureCheck("liquidationCollateral", "unknown", baselineFailure),
        createFailureCheck("liquidatable", "unknown", baselineFailure),
      ]
    : await (() => {
        const viewsBalancePromise = getClusterBalanceFromViews(
          networkConfig.rpcUrl,
          networkConfig.viewsAddress,
          cluster.owner,
          cluster.operatorIds,
          toViewsClusterState(cluster),
          fetchFn,
        );
        const viewsBurnRatePromise = getClusterBurnRateFromViews(
          networkConfig.rpcUrl,
          networkConfig.viewsAddress,
          cluster.owner,
          cluster.operatorIds,
          toViewsClusterState(cluster),
          fetchFn,
        );
        const viewsLiquidatablePromise = getClusterLiquidatableFromViews(
          networkConfig.rpcUrl,
          networkConfig.viewsAddress,
          cluster.owner,
          cluster.operatorIds,
          toViewsClusterState(cluster),
          fetchFn,
        );

        return Promise.all([
          runMutationCheck("owner", cluster.owner, () =>
          validateClusterStateWithViews(
            networkConfig.rpcUrl,
            networkConfig.viewsAddress,
            mutateAddress(cluster.owner),
            cluster.operatorIds,
            toViewsClusterState(cluster),
            fetchFn,
          ),
        ),
        runMutationCheck("operatorIds", formatOperatorIds(cluster.operatorIds), () =>
          validateClusterStateWithViews(
            networkConfig.rpcUrl,
            networkConfig.viewsAddress,
            cluster.owner,
            mutateOperatorIds(cluster.operatorIds),
            toViewsClusterState(cluster),
            fetchFn,
          ),
        ),
        runMutationCheck("validatorCount", String(cluster.validatorCount), () =>
          validateClusterStateWithViews(
            networkConfig.rpcUrl,
            networkConfig.viewsAddress,
            cluster.owner,
            cluster.operatorIds,
            {
              ...toViewsClusterState(cluster),
              validatorCount: cluster.validatorCount + 1,
            },
            fetchFn,
          ),
        ),
        runMutationCheck("active", String(cluster.active), () =>
          validateClusterStateWithViews(
            networkConfig.rpcUrl,
            networkConfig.viewsAddress,
            cluster.owner,
            cluster.operatorIds,
            {
              ...toViewsClusterState(cluster),
              active: !cluster.active,
            },
            fetchFn,
          ),
        ),
          viewsBalancePromise.then((viewsBalance) => {
            const derivedBalance = deriveCurrentClusterBalance(cluster, operators, daoValues, chainHeadBlock);
            const status: CheckStatus = derivedBalance === viewsBalance ? "pass" : "fail";

            return {
              name: "currentBalance",
              status,
              classification: status === "pass" ? "verified" : "mismatch",
              subgraphValue: derivedBalance.toString(),
              viewsValue: viewsBalance.toString(),
              detail: status === "pass"
                ? `Derived balance matched Views at block ${chainHeadBlock.toString()}`
                : `Derived balance did not match Views at block ${chainHeadBlock.toString()}`,
            } satisfies ClusterIdentityCheckResult;
          }),
          viewsBurnRatePromise.then((viewsBurnRate) => {
            const derivedBurnRate = deriveClusterBurnRate(cluster.validatorCount, operators, daoValues);
            const status: CheckStatus = derivedBurnRate === viewsBurnRate ? "pass" : "fail";

            return {
              name: "burnRate",
              status,
              classification: status === "pass" ? "verified" : "mismatch",
              subgraphValue: derivedBurnRate.toString(),
              viewsValue: viewsBurnRate.toString(),
              detail: status === "pass"
                ? "Derived burn rate matched Views"
                : "Derived burn rate did not match Views",
            } satisfies ClusterIdentityCheckResult;
          }),
          Promise.all([viewsBalancePromise, viewsLiquidatablePromise]).then(
            ([viewsBalance, viewsLiquidatable]) => {
              const derivedBalance = deriveCurrentClusterBalance(cluster, operators, daoValues, chainHeadBlock);
              const derivedBurnRate = deriveClusterBurnRate(cluster.validatorCount, operators, daoValues);
              const liquidationCollateral = deriveLiquidationCollateral(derivedBurnRate, daoValues);
              const expectedLiquidatable = deriveLiquidatableStatus(
                cluster.active,
                derivedBalance,
                liquidationCollateral,
              );
              const status: CheckStatus = expectedLiquidatable === viewsLiquidatable ? "pass" : "fail";

              return {
                name: "liquidationCollateral",
                status,
                classification: status === "pass" ? "verified" : "mismatch",
                subgraphValue: liquidationCollateral.toString(),
                viewsValue: String(viewsLiquidatable),
                detail: status === "pass"
                  ? `Derived collateral implied the same liquidatable status as Views at block ${chainHeadBlock.toString()} (balance=${derivedBalance.toString()})`
                  : `Derived collateral implied a different liquidatable status than Views at block ${chainHeadBlock.toString()} (balance=${derivedBalance.toString()})`,
              } satisfies ClusterIdentityCheckResult;
            },
          ),
          Promise.all([viewsBalancePromise, viewsLiquidatablePromise]).then(
            ([viewsBalance, viewsLiquidatable]) => {
              const derivedBalance = deriveCurrentClusterBalance(cluster, operators, daoValues, chainHeadBlock);
              const derivedBurnRate = deriveClusterBurnRate(cluster.validatorCount, operators, daoValues);
              const liquidationCollateral = deriveLiquidationCollateral(derivedBurnRate, daoValues);
              const expectedLiquidatable = deriveLiquidatableStatus(
                cluster.active,
                derivedBalance,
                liquidationCollateral,
              );
              const status: CheckStatus = expectedLiquidatable === viewsLiquidatable ? "pass" : "fail";

              return {
                name: "liquidatable",
                status,
                classification: status === "pass" ? "verified" : "mismatch",
                subgraphValue: String(expectedLiquidatable),
                viewsValue: String(viewsLiquidatable),
                detail: status === "pass"
                  ? `Derived liquidatable status matched Views at block ${chainHeadBlock.toString()} (balance=${viewsBalance.toString()}, collateral=${liquidationCollateral.toString()})`
                  : `Derived liquidatable status did not match Views at block ${chainHeadBlock.toString()} (balance=${viewsBalance.toString()}, collateral=${liquidationCollateral.toString()})`,
              } satisfies ClusterIdentityCheckResult;
            },
          ),
        ]);
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
