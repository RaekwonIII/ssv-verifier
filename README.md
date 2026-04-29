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

Use `verify-cluster` when you want a same-block check for one cluster.

```bash
npm run dev -- verify-cluster --network hoodi --cluster 0xe8c927a1fa792eddefe23fda643a62e03f999830-5-6-7-523
npm run dev -- verify-cluster --network hoodi --cluster 0xe8c927a1fa792eddefe23fda643a62e03f999830-5-6-7-523 --output json
```

`verify-cluster` parses the cluster ID, fetches a single pinned subgraph snapshot, and compares derived accounting values against `SSVNetworkViews` reads taken at the same indexed block. Results follow a root-cause-first model:

- Cluster IDs are `<owner>-<op1>-<op2>...` with a lowercased 0x-prefixed owner address and 4, 7, 10, or 13 strictly ascending unique decimal operator IDs.
- `--network both` is rejected for `verify-cluster` and irrelevant flags such as `--operator` are rejected at the CLI boundary.
- The result exposes one ordered list of `checks` and an always-present `accountingDebug` payload. Each check has `name`, `kind` (`input` / `derived` / `operational`), `status`, `reason`, and `detail`. Blocked downstream checks are still emitted with `reason: blocked` and `blockedBy` metadata.
- `clusterState` is the universal first gate, followed by `assetType` (compared directly against the on-chain Views asset surface), input gates (`daoData`, `operatorData`, `effectiveBalance` for ETH non-empty clusters, plus identity checks), the four independent derived checks (`currentBalance`, `burnRate`, `liquidationCollateral`, `liquidatable`), and the operational `subgraphLag` check.
- `subgraphLag` is reported only as an operational warning when the subgraph trails the chain head by more than three blocks; same-block comparisons stay hard mismatches.
- Public JSON is centralized: top-level keys are `network`, `clusterId`, `subgraphSource`, `verificationBlock`, `status`, `checks`, and `accountingDebug`. Unavailable optional fields are omitted instead of serialized as nulls.

Use `verify-clusters` when you want a network-wide cluster audit.

```bash
npm run dev -- verify-clusters --network hoodi
npm run dev -- verify-clusters --network mainnet
npm run dev -- verify-clusters --network both
```

`verify-clusters` reuses the same per-cluster result shape and adds a shared batch summary contract:

- Each network runs with a fixed concurrency limit of ten clusters; `--network both` runs the configured networks concurrently while preserving configured network order and original cluster listing order.
- Malformed discovered cluster IDs become structured per-cluster `clusterState` failures instead of aborting the batch.
- Network-level cluster-listing failures become structured discovery failures with `errorDetail` instead of crashing the run.
- Batch summaries expose canonical zero-filled `rootCauses`, `operational`, and `discovery` buckets at both the overall and per-network levels.
- Public JSON top-level keys are `selectedNetwork`, `status`, `summary`, and `networkResults` in that order. Each network result exposes its own `summary`, optional `clusterListingSource`, optional `errorDetail`, and ordered rendered per-cluster JSON.
- Human-readable batch output renders an overall header block, deterministic per-network blocks with `clusterListingSource`, conditional `root causes:` / `operational:` / `discovery:` lines, optional `error:` lines, and compact one-line summaries for non-passing clusters only.

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

## Mainnet fixture regeneration

```bash
npm run fixtures:generate
```

Regenerates the mainnet cluster fixtures under `test/fixtures/verify-cluster-mainnet/` from the authoritative seeds in `src/tools/cluster-fixture-seeds.ts`. The manifest-driven harness in `test/verify-cluster-fixture-manifest.test.ts` replays each fixture against the verifier and asserts both the in-memory result and the rendered public JSON match the generated `expected.json`.

## Reference

See `docs/commands.md` for command semantics, output notes, and caveats.

## Verification

```bash
npm test
npm run build
```
