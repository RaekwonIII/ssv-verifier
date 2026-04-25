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

  it("uses multiply-then-divide ETH scaling for balance and burn rate", () => {
    const balance = deriveCurrentClusterBalance(
      {
        feeAsset: "ETH",
        effectiveBalance: 33n,
        validatorCount: 1,
        networkFeeIndex: 0n,
        index: 0n,
        balance: 1000n,
      },
      [
        { fee: 0n, feeIndex: 0n, feeIndexBlockNumber: 100n },
        { fee: 0n, feeIndex: 0n, feeIndexBlockNumber: 100n },
      ],
      {
        networkFee: 64n,
        networkFeeIndex: 0n,
        networkFeeIndexBlockNumber: 100n,
      },
      101n,
    );
    const burnRate = deriveClusterBurnRate(
      {
        feeAsset: "ETH",
        effectiveBalance: 33n,
        validatorCount: 1,
      },
      [{ fee: 32n }],
      { networkFee: 32n },
    );

    expect(balance.value).toBe(934n);
    expect(balance.terms.balanceDelta).toMatchObject({
      rawValue: 64n,
      numerator: 33n,
      divisor: 32n,
      scaledValue: 66n,
    });
    expect(burnRate.value).toBe(66n);
    expect(burnRate.terms.burnRate).toMatchObject({
      rawValue: 64n,
      numerator: 33n,
      divisor: 32n,
      scaledValue: 66n,
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

  it("derives liquidation helpers from the pure accounting values", () => {
    const collateral = deriveLiquidationCollateral(30n, {
      liquidationThreshold: 10n,
      minimumLiquidationCollateral: 100n,
    });
    const liquidatable = deriveLiquidatableStatus(true, 299n, collateral.value);

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
      currentBalance: 299n,
      liquidationCollateral: 300n,
    });
  });
});
