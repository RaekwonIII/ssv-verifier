# Cluster Balance Validation Report

This document is the authoritative report-backed source for the mainnet cluster
fixture seeds consumed by the report-seeded fixture generator
(`npm run fixtures:generate`). Each section corresponds to a checked-in seed in
`src/tools/cluster-fixture-seeds.ts` and explains why the cluster snapshot is
expected to verify successfully against pinned Views reads at the recorded
block.

## ok-eth-active

A healthy mainnet ETH cluster verified at block 19,000,000. All indexed
accounting inputs match the pinned `SSVNetworkViews` reads, the on-chain asset
type is ETH, and burn rate is zero so liquidation collateral collapses to the
minimum collateral floor. The verifier should report a fully passing
verification.

## false-positive-eth-non-divisible

A mainnet ETH cluster verified at block 19,500,000 whose `effectiveBalance` is
not divisible by 32 ETH. The legacy verifier rejected this scenario as a
divisibility violation; the rewritten verifier follows cluster-balance-tool
multiply-then-divide semantics and is expected to verify successfully because
the derived current balance, burn rate, liquidation collateral, and
liquidatable status all match pinned Views reads at the verification block.
