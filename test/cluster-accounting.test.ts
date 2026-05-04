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
      scalingFactor: 10_000_000n,
      cumulativeOperatorFee: 32n,
      cumulativeNetworkFee: 28n,
      billingUnits: 2n,
      billingDivisor: 1n,
      balanceDelta: 120n,
      startingBalance: 500n,
    });
    expect(result.intermediates.burnRate).toMatchObject({
      operatorFeeSum: 8n,
      networkFee: 7n,
      totalFeeRate: 15n,
      billingUnits: 2n,
      billingDivisor: 1n,
      burnRate: 30n,
    });
  });

  it("uses vUnits-scaled ETH accounting with packed fees", () => {
    // Post-staking-update ETH path: operator/network fees are accumulated in
    // expanded (subgraph) space, then packed by scalingFactor (100_000) before
    // scaling by vUnits. Operator and network deltas are floored independently
    // to match the on-chain Views contract.
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

    // cumulativeOperatorFee = 20_000_000, cumulativeNetworkFee = 30_000_000
    // packed op = 200, packed net = 300
    // vUnits = ceil(59 * 10_000 / 32) = 18438
    // operator usage = floor(200 * 18438 / 10_000) = 368
    // network  usage = floor(300 * 18438 / 10_000) = 553
    // total usage units = 921, balance delta = 921 * 100_000 = 92_100_000
    expect(balance.terms).toMatchObject({
      scalingFactor: 100_000n,
      cumulativeOperatorFee: 20_000_000n,
      cumulativeNetworkFee: 30_000_000n,
      billingUnits: 18438n,
      billingDivisor: 10_000n,
      balanceDelta: 92_100_000n,
      startingBalance: 100_000_000_000_000n,
    });
    expect(balance.value).toBe(99_999_907_900_000n);

    // burn rate: floor((200_000 + 300_000) * 18438 / 10_000) = 921_900
    expect(burnRate.value).toBe(921_900n);
    expect(burnRate.terms).toMatchObject({
      operatorFeeSum: 200_000n,
      networkFee: 300_000n,
      totalFeeRate: 500_000n,
      billingUnits: 18438n,
      billingDivisor: 10_000n,
      burnRate: 921_900n,
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
    expect(result.intermediates.currentBalance.balanceDelta).toBe(0n);
    expect(result.intermediates.burnRate.burnRate).toBe(0n);
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
