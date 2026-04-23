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

Purpose: verify one cluster end to end.

What it checks:
- Owner, operator ids, validator count, and active state
- Current balance derived from subgraph inputs versus `Views.getBalance(...)`
- Burn rate
- Liquidation status
- Lag-aware mismatch classification

Supported networks:
- `hoodi`
- `mainnet`

Example:

```bash
npm run dev -- verify-cluster --network hoodi --cluster <cluster-id>
npm run dev -- verify-cluster --network hoodi --cluster <cluster-id> --output json
```

Notes:
- `--output json` is currently implemented for this command
- Lag-related mismatches can be downgraded to warnings when the subgraph is behind the chain head

## `verify-clusters`

Purpose: verify every subgraph-listed cluster for one or both networks.

What it checks:
- Runs the single-cluster verification flow for each discovered cluster
- Aggregates passing, warning, failing, and inconclusive results

Supported networks:
- `hoodi`
- `mainnet`
- `both`

Example:

```bash
npm run dev -- verify-clusters --network both
```

Notes:
- Batch summaries include overall status and network-level totals
- This command continues through non-passing cluster results so one bad item does not stop the batch

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
