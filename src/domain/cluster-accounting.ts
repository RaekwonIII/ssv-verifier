import type { FeeAsset } from "../clients/views.js";

const ETH_DEDUCTED_DIGITS = 100_000n;
const SSV_DEDUCTED_DIGITS = 10_000_000n;
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

function ethCurrentIndex(
  unpackedBaseIndex: bigint,
  rawFee: bigint,
  startBlock: bigint,
  currentBlock: bigint,
): CurrentIndexTerms {
  // The contract accumulates `op.snapshot.index` and `sp.networkFeeIndex` using
  // the *packed* fee (rawFee / ETH_DEDUCTED_DIGITS). The subgraph stores the
  // unpacked fee in `operator.fee` / `daovalues.networkFee` and the unpacked
  // index in `operator.feeIndex` / `daovalues.networkFeeIndex` (it accumulates
  // by `unpackedFee * blockDelta`). We project both back into contract space
  // by packing them with ETH_DEDUCTED_DIGITS so the result stays aligned with
  // the on-chain uint64 indices that `cluster.index` and
  // `cluster.networkFeeIndex` are stored in.
  const packedFee = rawFee / ETH_DEDUCTED_DIGITS;
  const packedBaseIndex = unpackedBaseIndex / ETH_DEDUCTED_DIGITS;
  return {
    baseIndex: unpackedBaseIndex,
    fee: rawFee,
    startBlock,
    currentBlock,
    precision: ETH_DEDUCTED_DIGITS,
    currentIndex: packedBaseIndex + (currentBlock - startBlock) * packedFee,
  };
}

function ssvCurrentIndex(
  baseIndex: bigint,
  rawFee: bigint,
  startBlock: bigint,
  currentBlock: bigint,
  baseIndexAlreadyExpanded: boolean,
): CurrentIndexTerms {
  // Legacy SSV semantics (pre-staking-update). `cluster.index` and
  // `cluster.networkFeeIndex` are stored packed (raw uint64), but the subgraph
  // exposes `operator.feeIndexSSV` and `daovalues.networkFeeIndexSSV` already
  // multiplied by SSV_DEDUCTED_DIGITS. We work in unpacked space throughout
  // and pack the final balance delta back via validatorCount scaling.
  const expandedBase = baseIndexAlreadyExpanded ? baseIndex : baseIndex * SSV_DEDUCTED_DIGITS;
  return {
    baseIndex,
    fee: rawFee,
    startBlock,
    currentBlock,
    precision: SSV_DEDUCTED_DIGITS,
    currentIndex: expandedBase + (currentBlock - startBlock) * rawFee,
  };
}

function deriveEthCurrentClusterBalance(
  cluster: Pick<ClusterAccountingClusterInputs, "effectiveBalance" | "validatorCount" | "networkFeeIndex" | "index" | "balance">,
  operators: ReadonlyArray<ClusterAccountingOperatorInputs>,
  daoValues: Pick<ClusterAccountingDaoInputs, "networkFee" | "networkFeeIndex" | "networkFeeIndexBlockNumber">,
  currentBlock: bigint,
): { value: bigint; terms: CurrentBalanceTerms } {
  const operatorCurrentIndexes = operators.map((operator) =>
    ethCurrentIndex(operator.feeIndex, operator.fee, operator.feeIndexBlockNumber, currentBlock),
  );
  const operatorCurrentIndexSum = operatorCurrentIndexes.reduce((sum, op) => sum + op.currentIndex, 0n);
  const networkCurrentIndex = ethCurrentIndex(
    daoValues.networkFeeIndex,
    daoValues.networkFee,
    daoValues.networkFeeIndexBlockNumber,
    currentBlock,
  );
  const operatorIndexDelta = operatorCurrentIndexSum - cluster.index;
  const networkIndexDelta = networkCurrentIndex.currentIndex - cluster.networkFeeIndex;
  const totalCurrentIndexes = operatorCurrentIndexSum + networkCurrentIndex.currentIndex;
  const totalClusterIndex = cluster.index + cluster.networkFeeIndex;
  const indexDelta = totalCurrentIndexes - totalClusterIndex;
  const vUnits = effectiveBalanceToVUnits(cluster.effectiveBalance ?? 0n);
  // The contract floors each delta independently before summing, then expands
  // by ETH_DEDUCTED_DIGITS. Doing the same here (rather than scaling the merged
  // `indexDelta`) is what produces a bit-exact match with the Views surface.
  const operatorUsageUnits = (operatorIndexDelta * vUnits) / VUNITS_PRECISION;
  const networkUsageUnits = (networkIndexDelta * vUnits) / VUNITS_PRECISION;
  const usageUnits = operatorUsageUnits + networkUsageUnits;
  const scaledValue = usageUnits * ETH_DEDUCTED_DIGITS;
  const balanceDelta: AssetScaledValueTerms = {
    asset: "ETH",
    rawValue: indexDelta,
    numerator: vUnits,
    divisor: VUNITS_PRECISION,
    scaledValue,
  };
  const value = cluster.balance - scaledValue;

  return {
    value,
    terms: {
      precision: ETH_DEDUCTED_DIGITS,
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

function deriveSsvCurrentClusterBalance(
  cluster: Pick<ClusterAccountingClusterInputs, "validatorCount" | "networkFeeIndex" | "index" | "balance">,
  operators: ReadonlyArray<ClusterAccountingOperatorInputs>,
  daoValues: Pick<ClusterAccountingDaoInputs, "networkFee" | "networkFeeIndex" | "networkFeeIndexBlockNumber">,
  currentBlock: bigint,
): { value: bigint; terms: CurrentBalanceTerms } {
  const operatorCurrentIndexes = operators.map((operator) =>
    ssvCurrentIndex(operator.feeIndex, operator.fee, operator.feeIndexBlockNumber, currentBlock, true),
  );
  const operatorCurrentIndexSum = operatorCurrentIndexes.reduce((sum, op) => sum + op.currentIndex, 0n);
  const networkCurrentIndex = ssvCurrentIndex(
    daoValues.networkFeeIndex,
    daoValues.networkFee,
    daoValues.networkFeeIndexBlockNumber,
    currentBlock,
    true,
  );
  const totalCurrentIndexes = operatorCurrentIndexSum + networkCurrentIndex.currentIndex;
  const totalClusterIndex = (cluster.index * SSV_DEDUCTED_DIGITS) + (cluster.networkFeeIndex * SSV_DEDUCTED_DIGITS);
  const indexDelta = totalCurrentIndexes - totalClusterIndex;
  const validatorCount = BigInt(cluster.validatorCount);
  const scaledValue = indexDelta * validatorCount;
  const balanceDelta: AssetScaledValueTerms = {
    asset: "SSV",
    rawValue: indexDelta,
    numerator: validatorCount,
    divisor: 1n,
    scaledValue,
  };
  const value = cluster.balance - scaledValue;

  return {
    value,
    terms: {
      precision: SSV_DEDUCTED_DIGITS,
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

export function deriveCurrentClusterBalance(
  cluster: Pick<ClusterAccountingClusterInputs, "feeAsset" | "effectiveBalance" | "validatorCount" | "networkFeeIndex" | "index" | "balance">,
  operators: ReadonlyArray<ClusterAccountingOperatorInputs>,
  daoValues: Pick<ClusterAccountingDaoInputs, "networkFee" | "networkFeeIndex" | "networkFeeIndexBlockNumber">,
  currentBlock: bigint,
): { value: bigint; terms: CurrentBalanceTerms } {
  if (cluster.feeAsset === "ETH") {
    return deriveEthCurrentClusterBalance(cluster, operators, daoValues, currentBlock);
  }
  return deriveSsvCurrentClusterBalance(cluster, operators, daoValues, currentBlock);
}

export function deriveClusterBurnRate(
  cluster: Pick<ClusterAccountingClusterInputs, "feeAsset" | "effectiveBalance" | "validatorCount">,
  operators: ReadonlyArray<Pick<ClusterAccountingOperatorInputs, "fee">>,
  daoValues: Pick<ClusterAccountingDaoInputs, "networkFee">,
): { value: bigint; terms: BurnRateTerms } {
  const operatorFeeSum = operators.reduce((sum, operator) => sum + operator.fee, 0n);
  const totalFeeRate = operatorFeeSum + daoValues.networkFee;

  if (cluster.feeAsset === "ETH") {
    const vUnits = effectiveBalanceToVUnits(cluster.effectiveBalance ?? 0n);
    const scaledValue = (totalFeeRate * vUnits) / VUNITS_PRECISION;
    const burnRate: AssetScaledValueTerms = {
      asset: "ETH",
      rawValue: totalFeeRate,
      numerator: vUnits,
      divisor: VUNITS_PRECISION,
      scaledValue,
    };

    return {
      value: scaledValue,
      terms: { operatorFeeSum, networkFee: daoValues.networkFee, totalFeeRate, burnRate },
    };
  }

  const validatorCount = BigInt(cluster.validatorCount);
  const scaledValue = totalFeeRate * validatorCount;
  const burnRate: AssetScaledValueTerms = {
    asset: "SSV",
    rawValue: totalFeeRate,
    numerator: validatorCount,
    divisor: 1n,
    scaledValue,
  };

  return {
    value: scaledValue,
    terms: { operatorFeeSum, networkFee: daoValues.networkFee, totalFeeRate, burnRate },
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
  // The contract `isLiquidatable` short-circuits to `false` whenever
  // `cluster.validatorCount == 0`, regardless of balance. Match that here so
  // we don't flag drained-but-empty clusters as liquidatable.
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
