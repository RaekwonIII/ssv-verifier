import type { FeeAsset } from "../clients/views.js";

const ETH_PRECISION = 100_000n;
const LEGACY_SSV_PRECISION = 10_000_000n;
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

export interface AssetScaledValueTerms {
  asset: FeeAsset;
  rawValue: bigint;
  numerator: bigint;
  divisor: bigint;
  scaledValue: bigint;
}

export interface CurrentIndexTerms {
  baseIndex: bigint;
  fee: bigint;
  startBlock: bigint;
  currentBlock: bigint;
  precision: bigint;
  currentIndex: bigint;
}

export interface CurrentBalanceTerms {
  precision: bigint;
  operatorCurrentIndexes: CurrentIndexTerms[];
  operatorCurrentIndexSum: bigint;
  networkCurrentIndex: CurrentIndexTerms;
  totalCurrentIndexes: bigint;
  totalClusterIndex: bigint;
  indexDelta: bigint;
  balanceDelta: AssetScaledValueTerms;
  startingBalance: bigint;
}

export interface BurnRateTerms {
  operatorFeeSum: bigint;
  networkFee: bigint;
  totalFeeRate: bigint;
  burnRate: AssetScaledValueTerms;
}

export interface LiquidationCollateralTerms {
  burnRate: bigint;
  liquidationThreshold: bigint;
  thresholdCollateral: bigint;
  minimumLiquidationCollateral: bigint;
}

export interface LiquidatableTerms {
  active: boolean;
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

function precisionForAsset(asset: FeeAsset): bigint {
  return asset === "ETH" ? ETH_PRECISION : LEGACY_SSV_PRECISION;
}

function currentIndex(
  baseIndex: bigint,
  fee: bigint,
  startBlock: bigint,
  currentBlock: bigint,
  precision: bigint,
): CurrentIndexTerms {
  return {
    baseIndex,
    fee,
    startBlock,
    currentBlock,
    precision,
    currentIndex: (baseIndex * precision) + ((currentBlock - startBlock) * fee),
  };
}

function scaleForAsset(
  asset: FeeAsset,
  rawValue: bigint,
  cluster: Pick<ClusterAccountingClusterInputs, "effectiveBalance" | "validatorCount">,
): AssetScaledValueTerms {
  if (asset === "ETH") {
    const numerator = cluster.effectiveBalance ?? 0n;

    return {
      asset,
      rawValue,
      numerator,
      divisor: ETH_VALIDATOR_CAPACITY,
      scaledValue: (rawValue * numerator) / ETH_VALIDATOR_CAPACITY,
    };
  }

  const numerator = BigInt(cluster.validatorCount);

  return {
    asset,
    rawValue,
    numerator,
    divisor: 1n,
    scaledValue: rawValue * numerator,
  };
}

export function deriveCurrentClusterBalance(
  cluster: Pick<ClusterAccountingClusterInputs, "feeAsset" | "effectiveBalance" | "validatorCount" | "networkFeeIndex" | "index" | "balance">,
  operators: ReadonlyArray<ClusterAccountingOperatorInputs>,
  daoValues: Pick<ClusterAccountingDaoInputs, "networkFee" | "networkFeeIndex" | "networkFeeIndexBlockNumber">,
  currentBlock: bigint,
): { value: bigint; terms: CurrentBalanceTerms } {
  const precision = precisionForAsset(cluster.feeAsset);
  const operatorCurrentIndexes = operators.map((operator) =>
    currentIndex(operator.feeIndex, operator.fee, operator.feeIndexBlockNumber, currentBlock, precision)
  );
  const operatorCurrentIndexSum = operatorCurrentIndexes.reduce((sum, operator) => sum + operator.currentIndex, 0n);
  const networkCurrentIndex = currentIndex(
    daoValues.networkFeeIndex,
    daoValues.networkFee,
    daoValues.networkFeeIndexBlockNumber,
    currentBlock,
    precision,
  );
  const totalCurrentIndexes = operatorCurrentIndexSum + networkCurrentIndex.currentIndex;
  const totalClusterIndex = (cluster.index * precision) + (cluster.networkFeeIndex * precision);
  const indexDelta = totalCurrentIndexes - totalClusterIndex;
  const balanceDelta = scaleForAsset(cluster.feeAsset, indexDelta, cluster);
  const value = cluster.balance - balanceDelta.scaledValue;

  return {
    value,
    terms: {
      precision,
      operatorCurrentIndexes,
      operatorCurrentIndexSum,
      networkCurrentIndex,
      totalCurrentIndexes,
      totalClusterIndex,
      indexDelta,
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
  const operatorFeeSum = operators.reduce((sum, operator) => sum + operator.fee, 0n);
  const totalFeeRate = operatorFeeSum + daoValues.networkFee;
  const burnRate = scaleForAsset(cluster.feeAsset, totalFeeRate, cluster);

  return {
    value: burnRate.scaledValue,
    terms: {
      operatorFeeSum,
      networkFee: daoValues.networkFee,
      totalFeeRate,
      burnRate,
    },
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
  currentBalance: bigint,
  liquidationCollateral: bigint,
): { value: boolean; terms: LiquidatableTerms } {
  return {
    value: active && currentBalance < liquidationCollateral,
    terms: {
      active,
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
  const liquidatable = deriveLiquidatableStatus(cluster.active, currentBalance.value, liquidationCollateral.value);

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
