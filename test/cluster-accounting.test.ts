import { describe, expect, it } from "vitest";

import {
  deriveClusterAccounting,
  deriveClusterBurnRate,
  deriveCurrentClusterBalance,
  deriveLiquidatableStatus,
  deriveLiquidationCollateral,
} from "../src/domain/cluster-accounting.js";

describe("cluster accounting", () => {
  it("derives SSV accounting outputs with structured intermediate terms", () => {
    const result = deriveClusterAccounting(
      {
        feeAsset: "SSV",
        effectiveBalance: null,
        validatorCount: 2,
        networkFeeIndex: 0n,
        index: 0n,
        balance: 500n,
        active: true,
      },
      [
        { fee: 3n, feeIndex: 0n, feeIndexBlockNumber: 100n },
        { fee: 5n, feeIndex: 0n, feeIndexBlockNumber: 100n },
      ],
      {
        networkFee: 7n,
        networkFeeIndex: 0n,
        networkFeeIndexBlockNumber: 100n,
        liquidationThreshold: 10n,
        minimumLiquidationCollateral: 100n,
      },
      104n,
    );

    expect(result.outputs).toEqual({
      currentBalance: 380n,
      burnRate: 30n,
      liquidationCollateral: 300n,
      liquidatable: false,
    });
    expect(result.intermediates.currentBalance).toMatchObject({
      precision: 10_000_000n,
      operatorCurrentIndexSum: 32n,
      totalCurrentIndexes: 60n,
      totalClusterIndex: 0n,
      indexDelta: 60n,
      balanceDelta: {
        asset: "SSV",
        rawValue: 60n,
        numerator: 2n,
        divisor: 1n,
        scaledValue: 120n,
      },
      startingBalance: 500n,
    });
    expect(result.intermediates.burnRate).toMatchObject({
      operatorFeeSum: 8n,
      networkFee: 7n,
      totalFeeRate: 15n,
      burnRate: {
        scaledValue: 30n,
      },
    });
  });

  it("uses vUnits-scaled ETH accounting with packed fees", () => {
    // Mirrors the post-staking-update SSVViews path: operator/network fees are
    // packed by ETH_DEDUCTED_DIGITS (100_000) before accumulating into the
    // index, and balance usage is scaled by vUnits / VUNITS_PRECISION (with
    // ceiling on non-divisible effective balances).
    const balance = deriveCurrentClusterBalance(
      {
        feeAsset: "ETH",
        effectiveBalance: 59n,
        validatorCount: 1,
        networkFeeIndex: 0n,
        index: 0n,
        balance: 100_000_000_000_000n,
      },
      [
        { fee: 200_000n, feeIndex: 0n, feeIndexBlockNumber: 100n },
      ],
      {
        networkFee: 300_000n,
        networkFeeIndex: 0n,
        networkFeeIndexBlockNumber: 100n,
      },
      200n,
    );
    const burnRate = deriveClusterBurnRate(
      {
        feeAsset: "ETH",
        effectiveBalance: 59n,
        validatorCount: 1,
      },
      [{ fee: 200_000n }],
      { networkFee: 300_000n },
    );

    // packed op fee = 2, packed net fee = 3, blocks elapsed = 100
    // newOpIdx = 200, newNetIdx = 300
    // vUnits = ceil(59 * 10_000 / 32) = ceil(18437.5) = 18438
    // operator usage = floor(200 * 18438 / 10_000) = 368
    // network  usage = floor(300 * 18438 / 10_000) = 553
    // total usage units = 921, balance delta = 921 * 100_000 = 92_100_000
    expect(balance.terms.balanceDelta).toMatchObject({
      asset: "ETH",
      rawValue: 500n,
      numerator: 18438n,
      divisor: 10_000n,
      scaledValue: 92_100_000n,
    });
    expect(balance.value).toBe(99_999_907_900_000n);

    // burn rate: floor((200_000 + 300_000) * 18438 / 10_000) = 921_900
    expect(burnRate.value).toBe(921_900n);
    expect(burnRate.terms.burnRate).toMatchObject({
      asset: "ETH",
      rawValue: 500_000n,
      numerator: 18438n,
      divisor: 10_000n,
      scaledValue: 921_900n,
    });
  });

  it("does not clamp negative current balance to zero", () => {
    const balance = deriveCurrentClusterBalance(
      {
        feeAsset: "SSV",
        effectiveBalance: null,
        validatorCount: 2,
        networkFeeIndex: 0n,
        index: 0n,
        balance: 10n,
      },
      [],
      {
        networkFee: 10n,
        networkFeeIndex: 0n,
        networkFeeIndexBlockNumber: 0n,
      },
      2n,
    );

    expect(balance.value).toBe(-30n);
  });

  it("keeps empty clusters on the dedicated zero-burn path", () => {
    const result = deriveClusterAccounting(
      {
        feeAsset: "ETH",
        effectiveBalance: null,
        validatorCount: 0,
        networkFeeIndex: 15n,
        index: 20n,
        balance: 75n,
        active: true,
      },
      [],
      {
        networkFee: 64n,
        networkFeeIndex: 12n,
        networkFeeIndexBlockNumber: 100n,
        liquidationThreshold: 10n,
        minimumLiquidationCollateral: 5n,
      },
      105n,
    );

    expect(result.outputs).toEqual({
      currentBalance: 75n,
      burnRate: 0n,
      liquidationCollateral: 5n,
      liquidatable: false,
    });
    expect(result.intermediates.currentBalance.balanceDelta.scaledValue).toBe(0n);
    expect(result.intermediates.burnRate.burnRate.scaledValue).toBe(0n);
  });

  it("derives liquidation helpers from the pure accounting values", () => {
    const collateral = deriveLiquidationCollateral(30n, {
      liquidationThreshold: 10n,
      minimumLiquidationCollateral: 100n,
    });
    const liquidatable = deriveLiquidatableStatus(true, 1, 299n, collateral.value);
    const emptyLiquidatable = deriveLiquidatableStatus(true, 0, 0n, collateral.value);

    expect(collateral.value).toBe(300n);
    expect(collateral.terms).toEqual({
      burnRate: 30n,
      liquidationThreshold: 10n,
      thresholdCollateral: 300n,
      minimumLiquidationCollateral: 100n,
    });
    expect(liquidatable.value).toBe(true);
    expect(liquidatable.terms).toEqual({
      active: true,
      validatorCount: 1,
      currentBalance: 299n,
      liquidationCollateral: 300n,
    });
    // Contract `isLiquidatable` short-circuits to false when validatorCount==0.
    expect(emptyLiquidatable.value).toBe(false);
  });
});
