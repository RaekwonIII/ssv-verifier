# SSV Verifier

Developer CLI for checking indexed SSV data against on-chain `Views` reads.

## Requirements

- Node.js 20+

## Setup

```bash
npm install
cp .env.example .env
```

Fill in the RPC URLs and `Views` addresses for `hoodi` and `mainnet`.

## Command Guide

Use `health-check` when you want to confirm the verifier can reach RPC, subgraph, and `Views`.

```bash
npm run dev -- --network hoodi
npm run dev -- health-check --network mainnet
npm run dev -- health-check --network both
```

Use `verify-network` when you want to compare network-wide ETH and SSV constants between the subgraph and the asset-aware `Views` surface.

```bash
npm run dev -- verify-network --network hoodi
npm run dev -- verify-network --network mainnet
npm run dev -- verify-network --network both
npm run dev -- verify-network --network hoodi --output json
```

The `verify-network` command compares ETH and SSV network constants from the subgraph against the asset-aware `Views` surface and groups the output by asset type for each network.

Use `verify-cluster` when you want a full check for one cluster.

```bash
npm run dev -- verify-cluster --network hoodi --cluster 0xe8c927a1fa792eddefe23fda643a62e03f999830-5-6-7-523
npm run dev -- verify-cluster --network hoodi --cluster 0xe8c927a1fa792eddefe23fda643a62e03f999830-5-6-7-523 --output json
```

`verify-cluster` checks cluster identity fields, derives current balance from subgraph accounting inputs, compares that result with `Views.getBalance(...)`, and verifies burn rate plus liquidation status.

Use `verify-clusters` when you want a network-wide cluster audit.

```bash
npm run dev -- verify-clusters --network hoodi
npm run dev -- verify-clusters --network mainnet
npm run dev -- verify-clusters --network both
```

Use `verify-operator` when you want to compare one operator record against `Views`.

```bash
npm run dev -- verify-operator --network hoodi --operator 17
npm run dev -- verify-operator --network mainnet --operator 42
```

## Built CLI

```bash
npm run build
node dist/index.js --network hoodi
node dist/index.js health-check --network both
node dist/index.js verify-network --network hoodi
node dist/index.js verify-cluster --network hoodi --cluster 0xe8c927a1fa792eddefe23fda643a62e03f999830-5-6-7-523 --output json
node dist/index.js verify-clusters --network both
node dist/index.js verify-operator --network hoodi --operator 17
```

## Reference

See `docs/commands.md` for command semantics, output notes, and caveats.

## Verification

```bash
npm test
npm run build
```
