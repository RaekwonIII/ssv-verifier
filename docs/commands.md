# Command Reference

This document describes the current public CLI surface.

## `health-check`

Purpose: confirm source reachability before deeper verification.

What it checks:
- RPC responds to `eth_blockNumber`
- The configured subgraph responds to `_meta`
- The configured `Views` address has deployed bytecode

Supported networks:
- `hoodi`
- `mainnet`
- `both`

Example:

```bash
npm run dev -- health-check --network both
```

Notes:
- Running the CLI with no subcommand defaults to `health-check`
- This command is about connectivity, not protocol correctness

## `verify-network`

Purpose: compare network-wide constants from the subgraph and `Views`.

What it checks:
- `networkFee`
- `liquidationThreshold`
- `minimumLiquidationCollateral`

Supported networks:
- `hoodi`
- `mainnet`

Example:

```bash
npm run dev -- verify-network --network hoodi
```

Notes:
- `--network both` is not supported because the current command returns a single-network result
- Failures here mean the indexed DAO values do not match `Views`

## `verify-cluster`

Purpose: verify one cluster against pinned `Views` reads using a same-block verification model.

Cluster ID grammar:
- `<owner>-<op1>-<op2>...` with a lowercased 0x-prefixed 40-hex-character owner address.
- 4, 7, 10, or 13 operator IDs.
- Operator IDs are canonical positive decimal integers without leading zeroes, strictly ascending, and unique.

Result shape:
- An ordered, root-cause-first list of `checks`. Each check has `name`, `kind` (`input` / `derived` / `operational`), `status`, `reason`, and `detail`.
- Input gates run first, in canonical order: `clusterState`, `assetType`, `daoData`, `operatorData` (omitted for empty clusters), and `effectiveBalance` (ETH non-empty clusters only).
- Derived checks run independently once applicable input gates pass: `currentBalance`, `burnRate`, `liquidationCollateral`, `liquidatable`.
- The operational `subgraphLag` check warns only when the subgraph trails the chain head by more than three blocks; same-block mismatches remain hard mismatches.
- Blocked downstream checks stay visible with `reason: blocked`, explicit `blockedBy` metadata, and no comparison values.
- Public JSON keys are emitted in this order: `network`, `clusterId`, `subgraphSource`, `verificationBlock`, `status`, `checks`, `accountingDebug`. Unavailable optional fields are omitted instead of serialized as nulls. `accountingDebug` is always present.

Supported networks:
- `hoodi`
- `mainnet`

Example:

```bash
npm run dev -- verify-cluster --network hoodi --cluster <cluster-id>
npm run dev -- verify-cluster --network hoodi --cluster <cluster-id> --output json
```

Notes:
- `--network both` and irrelevant flags such as `--operator` are rejected at the CLI boundary.
- Normal human-readable output prints the canonical headers and per-check lines but does not include `accountingDebug`.

## `verify-clusters`

Purpose: verify every subgraph-listed cluster for one or both networks while preserving deterministic ordering and structured failure handling.

Execution model:
- Each network runs with a fixed concurrency limit of ten clusters per network.
- `--network both` executes both networks concurrently while preserving configured network order and original cluster listing order.
- Malformed discovered cluster IDs become structured per-cluster `clusterState` failures instead of aborting the batch.
- Network-level cluster-listing failures become structured discovery results with `errorDetail` instead of crashing the run.

Batch summary model:
- Every per-network and overall result includes a fixed zero-filled summary object with three buckets:
  - `rootCauses`: counts only real non-blocked input causes (keys include `clusterState`, `assetType`, `daoData`, `operatorData`, `effectiveBalance`).
  - `operational`: counts lag warnings.
  - `discovery`: counts only network-level cluster-listing failures.

Public JSON contract:
- Top-level keys, in order: `selectedNetwork`, `status`, `summary`, `networkResults`.
- Each `networkResults` entry exposes `network`, `status`, `summary`, optional `clusterListingSource`, optional `errorDetail`, and ordered `clusterResults` rendered through the canonical public cluster JSON shape.

Human-readable output:
- One overall header block followed by deterministic per-network blocks with `clusterListingSource` context.
- Conditional `root causes:`, `operational:`, and `discovery:` lines (skipped when empty) plus an `error:` line on listing failures.
- Only non-passing clusters are listed, each as a compact one-line summary using internal check names, statuses, and reasons.

Supported networks:
- `hoodi`
- `mainnet`
- `both`

Example:

```bash
npm run dev -- verify-clusters --network both
npm run dev -- verify-clusters --network mainnet --output json
```

## `verify-operator`

Purpose: verify one operator record against `Views`.

What it checks:
- Operator fee
- Validator count
- Active status

Supported networks:
- `hoodi`
- `mainnet`

Example:

```bash
npm run dev -- verify-operator --network hoodi --operator 17
```

Notes:
- This command currently verifies one operator at a time
- Broader operator-surface and batch verification work is not in the CLI yet
