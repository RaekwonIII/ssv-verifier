import type { FeeAsset } from "../clients/views.js";

interface AssetConfig {
  scalingFactor: bigint;
}

const assetConfigs: Record<FeeAsset, AssetConfig> = {
  ETH: { scalingFactor: 100_000n },
  SSV: { scalingFactor: 10_000_000n },
};

const VUNITS_PRECISION = 10_000n;
const ETH_VALIDATOR_CAPACITY = 32n;

export interface ClusterAccountingClusterInputs {
  feeAsset: FeeAsset;
  effectiveBalance: bigint | null;
  validatorCount: number;
  networkFeeIndex: bigint;
  index: bigint;
  balance: bigint;
  active: boolean;
}

export interface ClusterAccountingOperatorInputs {
  fee: bigint;
  feeIndex: bigint;
  feeIndexBlockNumber: bigint;
}

export interface ClusterAccountingDaoInputs {
  networkFee: bigint;
  networkFeeIndex: bigint;
  networkFeeIndexBlockNumber: bigint;
  liquidationThreshold: bigint;
  minimumLiquidationCollateral: bigint;
}

export interface CurrentBalanceTerms {
  scalingFactor: bigint;
  cumulativeOperatorFee: bigint;
  cumulativeNetworkFee: bigint;
  billingUnits: bigint;
  billingDivisor: bigint;
  balanceDelta: bigint;
  startingBalance: bigint;
}

export interface BurnRateTerms {
  operatorFeeSum: bigint;
  networkFee: bigint;
  totalFeeRate: bigint;
  billingUnits: bigint;
  billingDivisor: bigint;
  burnRate: bigint;
}

export interface LiquidationCollateralTerms {
  burnRate: bigint;
  liquidationThreshold: bigint;
  thresholdCollateral: bigint;
  minimumLiquidationCollateral: bigint;
}

export interface LiquidatableTerms {
  active: boolean;
  validatorCount: number;
  currentBalance: bigint;
  liquidationCollateral: bigint;
}

export interface ClusterAccountingOutputs {
  currentBalance: bigint;
  burnRate: bigint;
  liquidationCollateral: bigint;
  liquidatable: boolean;
}

export interface ClusterAccountingIntermediates {
  currentBalance: CurrentBalanceTerms;
  burnRate: BurnRateTerms;
  liquidationCollateral: LiquidationCollateralTerms;
  liquidatable: LiquidatableTerms;
}

export interface ClusterAccountingResult {
  outputs: ClusterAccountingOutputs;
  intermediates: ClusterAccountingIntermediates;
}

// Ceiling division of `effectiveBalance * VUNITS_PRECISION / ETH_VALIDATOR_CAPACITY`.
// Mirrors the contract's `ebToVUnits` helper used by `updateBalanceWithEB` and
// `getBurnRate` in the post-staking-update SSVViews module.
function effectiveBalanceToVUnits(effectiveBalance: bigint): bigint {
  const scaled = effectiveBalance * VUNITS_PRECISION;
  if (scaled === 0n) return 0n;
  return ((scaled - 1n) / ETH_VALIDATOR_CAPACITY) + 1n;
}

function getBillingUnits(
  feeAsset: FeeAsset,
  cluster: Pick<ClusterAccountingClusterInputs, "effectiveBalance" | "validatorCount">,
): { units: bigint; divisor: bigint } {
  if (feeAsset === "ETH") {
    return { units: effectiveBalanceToVUnits(cluster.effectiveBalance ?? 0n), divisor: VUNITS_PRECISION };
  }
  return { units: BigInt(cluster.validatorCount), divisor: 1n };
}

export function deriveCurrentClusterBalance(
  cluster: Pick<ClusterAccountingClusterInputs, "feeAsset" | "effectiveBalance" | "validatorCount" | "networkFeeIndex" | "index" | "balance">,
  operators: ReadonlyArray<ClusterAccountingOperatorInputs>,
  daoValues: Pick<ClusterAccountingDaoInputs, "networkFee" | "networkFeeIndex" | "networkFeeIndexBlockNumber">,
  currentBlock: bigint,
): { value: bigint; terms: CurrentBalanceTerms } {
  const { scalingFactor } = assetConfigs[cluster.feeAsset];
  const { units: billingUnits, divisor: billingDivisor } = getBillingUnits(cluster.feeAsset, cluster);

  // Accumulate fee deltas in expanded (subgraph) space.
  let cumulativeOperatorFee = -cluster.index * scalingFactor;
  for (const operator of operators) {
    cumulativeOperatorFee +=
      operator.feeIndex +
      (currentBlock - operator.feeIndexBlockNumber) * operator.fee;
  }

  const cumulativeNetworkFee =
    daoValues.networkFeeIndex +
    (currentBlock - daoValues.networkFeeIndexBlockNumber) * daoValues.networkFee -
    cluster.networkFeeIndex * scalingFactor;

  // Scale the fee deltas into a balance delta.
  // ETH clusters floor operator and network deltas independently in packed
  // space before scaling by vUnits, matching the on-chain Views contract.
  // SSV clusters multiply the combined expanded delta by validatorCount.
  let balanceDelta: bigint;
  if (cluster.feeAsset === "ETH") {
    const packedOperatorDelta = cumulativeOperatorFee / scalingFactor;
    const packedNetworkDelta = cumulativeNetworkFee / scalingFactor;
    const operatorUsage = (packedOperatorDelta * billingUnits) / billingDivisor;
    const networkUsage = (packedNetworkDelta * billingUnits) / billingDivisor;
    balanceDelta = (operatorUsage + networkUsage) * scalingFactor;
  } else {
    balanceDelta = (cumulativeOperatorFee + cumulativeNetworkFee) * billingUnits;
  }

  const value = cluster.balance - balanceDelta;

  return {
    value,
    terms: {
      scalingFactor,
      cumulativeOperatorFee,
      cumulativeNetworkFee,
      billingUnits,
      billingDivisor,
      balanceDelta,
      startingBalance: cluster.balance,
    },
  };
}

export function deriveClusterBurnRate(
  cluster: Pick<ClusterAccountingClusterInputs, "feeAsset" | "effectiveBalance" | "validatorCount">,
  operators: ReadonlyArray<Pick<ClusterAccountingOperatorInputs, "fee">>,
  daoValues: Pick<ClusterAccountingDaoInputs, "networkFee">,
): { value: bigint; terms: BurnRateTerms } {
  const { units: billingUnits, divisor: billingDivisor } = getBillingUnits(cluster.feeAsset, cluster);
  const operatorFeeSum = operators.reduce((sum, operator) => sum + operator.fee, 0n);
  const totalFeeRate = operatorFeeSum + daoValues.networkFee;
  const burnRate = (totalFeeRate * billingUnits) / billingDivisor;

  return {
    value: burnRate,
    terms: { operatorFeeSum, networkFee: daoValues.networkFee, totalFeeRate, billingUnits, billingDivisor, burnRate },
  };
}

export function deriveLiquidationCollateral(
  burnRate: bigint,
  daoValues: Pick<ClusterAccountingDaoInputs, "liquidationThreshold" | "minimumLiquidationCollateral">,
): { value: bigint; terms: LiquidationCollateralTerms } {
  const thresholdCollateral = burnRate * daoValues.liquidationThreshold;
  const value = thresholdCollateral > daoValues.minimumLiquidationCollateral
    ? thresholdCollateral
    : daoValues.minimumLiquidationCollateral;

  return {
    value,
    terms: {
      burnRate,
      liquidationThreshold: daoValues.liquidationThreshold,
      thresholdCollateral,
      minimumLiquidationCollateral: daoValues.minimumLiquidationCollateral,
    },
  };
}

export function deriveLiquidatableStatus(
  active: boolean,
  validatorCount: number,
  currentBalance: bigint,
  liquidationCollateral: bigint,
): { value: boolean; terms: LiquidatableTerms } {
  const value = active && validatorCount > 0 && currentBalance < liquidationCollateral;
  return {
    value,
    terms: {
      active,
      validatorCount,
      currentBalance,
      liquidationCollateral,
    },
  };
}

export function deriveClusterAccounting(
  cluster: ClusterAccountingClusterInputs,
  operators: ReadonlyArray<ClusterAccountingOperatorInputs>,
  daoValues: ClusterAccountingDaoInputs,
  currentBlock: bigint,
): ClusterAccountingResult {
  const currentBalance = deriveCurrentClusterBalance(cluster, operators, daoValues, currentBlock);
  const burnRate = deriveClusterBurnRate(cluster, operators, daoValues);
  const liquidationCollateral = deriveLiquidationCollateral(burnRate.value, daoValues);
  const liquidatable = deriveLiquidatableStatus(
    cluster.active,
    cluster.validatorCount,
    currentBalance.value,
    liquidationCollateral.value,
  );

  return {
    outputs: {
      currentBalance: currentBalance.value,
      burnRate: burnRate.value,
      liquidationCollateral: liquidationCollateral.value,
      liquidatable: liquidatable.value,
    },
    intermediates: {
      currentBalance: currentBalance.terms,
      burnRate: burnRate.terms,
      liquidationCollateral: liquidationCollateral.terms,
      liquidatable: liquidatable.terms,
    },
  };
}
