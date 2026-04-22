# SSV Verifier Plan

## Goal

Build a developer-focused CLI project that verifies the correctness of subgraph-indexed SSV data by comparing it against the on-chain `Views` proxy contract, which is treated as the source of truth.

The verifier should support:
- `hoodi` only
- `mainnet` only
- both networks in a single run

The verifier should compare:
1. direct subgraph fields vs on-chain values from `Views`
2. locally derived values computed from subgraph inputs vs on-chain values from `Views`

This is especially important for values like current cluster balance, where:
- the subgraph contains enough raw inputs to calculate the value
- the `Views` contract returns the authoritative current value

---

## Technology Choice

Use `TypeScript` on Node.js.

### Why
- strong ecosystem for Ethereum contract access via `ethers`
- native `bigint` support for exact accounting
- good CLI tooling
- easy GraphQL and HTTP integration
- fast iteration for both local development and future automation

---

## Product Shape

Start as a developer CLI, not a long-running service.

This keeps the first version simple and lets the core verification logic mature before adding automation, persistence, or dashboards.

The CLI should accept runtime network selection:
- `--network hoodi`
- `--network mainnet`
- `--network both`

---

## Core Verification Model

Treat the `Views` contract as the source of truth.

Each verification check should declare:
- check name
- network
- source subgraph field(s)
- source `Views` call
- optional local derivation formula
- normalization rules
- comparison logic
- pass/fail/inconclusive result

### Verification patterns

#### 1. Direct checks
Compare a subgraph field directly to a `Views` contract value.

Example:
- subgraph cluster metadata
- on-chain cluster metadata from `Views`

#### 2. Derived checks
Use subgraph inputs to calculate a value locally, then compare it to the `Views` value.

Example:
- current cluster balance derived from:
  - cluster data
  - operator data
  - DAO values
  - current block
- compare to `Views.getBalance(...)`

---

## Project Initialization

Initialize a TypeScript CLI project with strict typing and test support.

### Recommended dependencies
- `typescript`
- `tsx`
- `ethers`
- `zod`
- `vitest`

Optional later:
- GraphQL client library, or plain `fetch`
- table/reporting helpers
- concurrency helpers

### Initial repository structure

```text
ssv-verifier/
  src/
    config/
      env.ts
      networks.ts
    clients/
      rpc.ts
      subgraph.ts
      views.ts
    abi/
      ISSVViews.json
    domain/
      types.ts
      normalizers.ts
      formulas.ts
      comparators.ts
      cluster-id.ts
    fetchers/
      clusters.ts
      operators.ts
      dao-values.ts
    verifiers/
      cluster-verifier.ts
      operator-verifier.ts
      network-verifier.ts
    reporting/
      result-types.ts
      console-reporter.ts
      json-reporter.ts
    commands/
      verify-cluster.ts
      verify-all-clusters.ts
      verify-operators.ts
      verify-network.ts
    index.ts
  test/
    unit/
    integration/
    fixtures/
  docs/
  .env.example
  package.json
  tsconfig.json
```

---

## Configuration Model

Define runtime configuration for:
- RPC URL per network
- subgraph primary URL per network
- subgraph fallback URL per network
- `THEGRAPH_API_KEY`
- `Views` contract address per network
- DAO contract address per network

Use validated env loading at startup.

---

## Domain Rules To Encode Early

Centralize these rules in one place:
- string to `bigint`
- lowercased addresses
- `owner.id` extraction
- `operatorIds: string[] -> number[]`
- cluster ID formatting
- packed index expansion using correct `PRECISION`
- ETH vs legacy SSV cluster branching from subgraph data
- block-context handling
- lag-aware result classification

Use:
- `ssv-protocol.md` for formulas
- `subgraph.md` for field mappings and subgraph handling
- `ssv-contracts.md` for contract behavior and caveats

---

## Milestones

## Milestone 1: Bootstrap The CLI Project

### Tasks
- initialize Node + TypeScript project
- add strict TypeScript config
- add env parsing and validation
- add CLI entrypoint
- add network runtime selection for `hoodi`, `mainnet`, and `both`

### Deliverable
A runnable CLI skeleton with validated config and network selection.

---

## Milestone 2: Build Source Clients

### Tasks
- implement RPC client
- implement subgraph client with primary/fallback logic
- implement `Views` contract client
- add ABI for the `Views` proxy
- add current block fetch support
- add subgraph `_meta` fetch support

### Deliverable
Simple commands can fetch one cluster from:
- subgraph
- `Views`
- RPC

---

## Milestone 3: Implement Domain Models And Formulas

### Tasks
- define normalized types for cluster, operator, and DAO values
- implement pure functions for:
  - current index
  - current cluster balance
  - burn rate
  - liquidation collateral
  - runway
  - cluster hash / ID helpers
- add support for both cluster types where applicable
- encode legacy SSV contract caveats from `ssv-contracts.md`

### Deliverable
A pure domain layer with unit tests for formulas and normalization.

---

## Milestone 4: Build Single-Cluster Verification

### Tasks
- implement `verify-cluster`
- accept network and cluster ID
- fetch subgraph cluster data
- fetch related operator and DAO data
- compute derived values locally
- fetch authoritative values from `Views`
- compare results and classify output

### Deliverable
A CLI command that verifies one cluster and prints:
- raw subgraph values
- derived local values
- `Views` truth values
- pass/fail per check

---

## Milestone 5: Add First Verification Suite

Start with a focused set of high-value checks.

### Initial target checks
- cluster existence / ID consistency
- owner
- operator IDs
- validator count
- active status
- current cluster balance
- burn rate
- liquidation collateral
- liquidatable status

### Deliverable
A useful first verifier covering the most important cluster correctness checks.

---

## Milestone 6: Add Batch Verification

### Tasks
- implement `verify-all-clusters`
- paginate clusters from the subgraph
- verify clusters in batches
- add concurrency limits
- add retry handling for RPC/subgraph failures
- support `hoodi`, `mainnet`, or both in one invocation

### Deliverable
A batch CLI command that verifies an entire network or both networks.

---

## Milestone 7: Reporting And Result Formats

### Tasks
- define result schema
- add console reporting
- add JSON output mode
- classify outcomes as:
  - pass
  - mismatch
  - missing in subgraph
  - missing on-chain
  - inconclusive due to lag
  - fetch/query error

### Deliverable
Readable and machine-consumable verifier output.

---

## Milestone 8: Freshness And Lag Handling

### Tasks
- compare chain head vs subgraph `_meta.block.number`
- include lag in verification context
- downgrade some mismatches to warnings or inconclusive when lag is likely the cause
- make lag thresholds configurable

### Deliverable
Reduced false positives caused by indexing delay.

---

## Milestone 9: Expand Verification Coverage

### Tasks
- add operator-level verification
- add DAO/network parameter verification
- add network invariants
- add whitelist/privacy-related checks where practical
- add direct checks for fields exposed clearly by `Views`

### Deliverable
A broader verifier that covers more than cluster accounting.

---

## Milestone 10: Harden For Ongoing Use

### Tasks
- improve fixture coverage
- add integration tests
- support stable JSON output for automation
- document CLI workflows
- prepare for scheduled or repeated execution later

### Deliverable
A reliable developer tool that can later evolve into monitoring or CI automation.

---

## Testing Strategy

## Unit Tests
Use unit tests for:
- formulas
- packing and unpacking rules
- normalization
- comparison logic
- cluster ID and hash helpers

## Integration Tests
Use integration tests for:
- subgraph queries
- `Views` contract reads
- end-to-end verification of known clusters

## Fixtures
Create fixtures for:
- cluster snapshots
- operators
- DAO values
- expected derived outputs

The goal is to make the math trustworthy before scaling batch verification.

---

## Command Surface

Planned commands:

```bash
verify-cluster --network hoodi --cluster <id>
verify-cluster --network mainnet --cluster <id>
verify-cluster --network both --cluster <id>
verify-all-clusters --network hoodi
verify-all-clusters --network mainnet
verify-all-clusters --network both
verify-operators --network hoodi
verify-operators --network mainnet
verify-network --network hoodi
verify-network --network mainnet
```

Optional output modes:
- default console summary
- `--json`

---

## Comparison Rules

Each check should define:
- expected source: `subgraph` or `derived`
- actual source: `Views`
- comparison mode: exact equality unless domain rules require otherwise
- caveats: lag, packing, scaling, or block context

Example:
- `currentBalance`
  - expected source: derived from subgraph inputs
  - actual source: `Views.getBalance(...)`
  - comparison mode: exact `bigint` equality

---

## Risks And Design Constraints

### 1. Subgraph lag
Recent state changes may not yet be indexed.

### 2. Block context mismatch
Subgraph-derived values and `Views` values must be compared with care if they are effectively observed at different block heights.

### 3. Packed index interpretation
Incorrect precision handling will cause systematic mismatches.

### 4. Cluster type branching
ETH and legacy SSV paths must be handled correctly.

### 5. ABI and interface assumptions
The real `Views` ABI must be verified from deployed contracts or known build artifacts.

### 6. Batch scale and rate limits
Both RPC and subgraph queries may need throttling and retries.

---

## Recommended First Slice

Do not begin with full-network coverage.

Start with:
1. both-network support in config and CLI
2. single-cluster verification
3. 5 to 8 high-value checks
4. formula unit tests
5. then batch verification

This gets to a useful tool quickly while keeping implementation risk controlled.

---

## End-State Vision

A developer CLI that can:
- verify one cluster or all clusters
- run against `hoodi`, `mainnet`, or both
- compare subgraph values against `Views`
- recompute derived values locally from subgraph inputs
- identify real mismatches vs likely lag-induced issues
- produce human and machine-readable reports

This should be the foundation for later automation, monitoring, and regression detection.
