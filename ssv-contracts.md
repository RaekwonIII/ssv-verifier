# SSV Contracts

## Overview

This repository implements the on-chain SSV Network contract system for managing operators, validator clusters, fee accounting, whitelisting, liquidation, and DAO-controlled protocol parameters.

Architecturally, it is a hybrid:
- `SSVNetwork` is the main user-facing proxy and entrypoint
- Business logic lives in separate stateless module contracts
- Storage is shared through diamond-storage-style libraries
- `SSVNetwork` and `SSVNetworkViews` are UUPS-upgradeable

Important scope note for agents: the `~/dev/ssv-network` repository reflects the legacy SSV-token contract system (`v1.2.0`), not the newer dual ETH-vs-legacy-SSV surface described in broader protocol docs. In that codebase, cluster balances, fees, deposits, withdrawals, operator earnings, and DAO earnings are all denominated in the ERC-20 SSV token.

## Main Contracts

### Entry Points

- `contracts/SSVNetwork.sol`
  - Main write entrypoint
  - Exposes the combined `ISSVOperators`, `ISSVOperatorsWhitelist`, `ISSVClusters`, and `ISSVDAO` interfaces
  - Delegates business logic to module contracts via `delegatecall`
  - DAO-owned upgrade and module-routing control lives here

- `contracts/SSVNetworkViews.sol`
  - Upgradeable read facade
  - Forwards view calls to the network's views implementation

- `contracts/SSVProxy.sol`
  - Minimal delegatecall helper used by `SSVNetwork`

### Logic Modules

- `contracts/modules/SSVClusters.sol`
  - Validator registration, removal, and bulk ops
  - Cluster deposit, withdrawal, reactivation, and liquidation
  - Emits validator and cluster lifecycle events

- `contracts/modules/SSVOperators.sol`
  - Operator registration and removal
  - Operator fee declaration, execution, and reduction
  - Operator earnings withdrawal
  - Privacy and public toggle for operators

- `contracts/modules/SSVOperatorsWhitelist.sol`
  - Internal bitmap-based whitelist management for EOAs and generic contracts
  - External whitelisting-contract integration
  - Backward-compatibility bridge for legacy whitelist storage

- `contracts/modules/SSVDAO.sol`
  - DAO-controlled protocol parameters
  - Controls network fee, liquidation threshold, minimum liquidation collateral, fee-change windows, operator fee increase limit, and max operator fee
  - Handles DAO and network earnings withdrawal

- `contracts/modules/SSVViews.sol`
  - Core read logic
  - Reads operator data, cluster balance, burn rate, liquidatability, whitelist state, protocol parameters, and operator and network earnings

### Supporting Contracts

- `contracts/whitelisting/BasicWhitelisting.sol`
  - Simple example external whitelist contract implementing `ISSVWhitelistingContract`

- `contracts/token/SSVToken.sol`
  - Local ERC-20 token contract used for testing and deployment contexts

## Core State And Data Model

### Operators

An operator is keyed by `operatorId` and stores:
- owner
- fee
- validator count
- privacy flag (`whitelisted` means private)
- fee snapshot with block, index, and balance

Operator earnings accrue lazily through snapshot math rather than per-block writes.

### Clusters

A cluster is identified by:

```text
keccak256(abi.encodePacked(owner, operatorIds))
```

Cluster state is passed by callers and verified on-chain against a stored hash. Main fields:
- `validatorCount`
- `networkFeeIndex`
- `index`
- `active`
- `balance`

Operationally, callers must supply the current cluster struct, and the contract checks it against stored hashed state before mutation.

### Validators

Validator existence and state are tracked by:

```text
keccak256(abi.encodePacked(publicKey, clusterOwner))
```

Stored validator data encodes:
- hashed operator set
- active flag in the low bit

### Protocol And Global State

Protocol storage tracks:
- network fee and fee index
- DAO validator count
- DAO and network earnings
- liquidation threshold
- minimum liquidation collateral
- operator fee governance parameters
- validators-per-operator cap

### Precision And Scaling

`contracts/libraries/Types.sol` uses packed SSV precision with a `10^7` divisor for shrunk values. Many on-chain fee and index fields are stored as compressed `uint64` values and expanded on read or use.

## Key Operational Flows

### 1. Cluster Lifecycle

1. Cluster owner registers validator(s) with an operator set.
2. The contract validates:
   - operator count shape (`4`, `7`, `10`, `13`)
   - operator ordering and uniqueness
   - whitelist authorization if an operator is private
   - supplied cluster state hash
3. Operator snapshots and DAO totals are updated.
4. Cluster balance is increased by any supplied deposit amount.
5. Cluster becomes or remains active until liquidated.
6. Validators can later be removed or exited, and cluster accounting is updated accordingly.

### 2. Fees And Accounting

Accounting is snapshot and index based:
- each operator has a fee index and accumulated balance
- the protocol has a network fee index and DAO earnings accumulator
- cluster balance is reduced by summed operator fee consumption and network fee consumption, both scaled by validator count

This is lazy accounting: balances are realized when a relevant function or view recomputes indexes against the current block.

### 3. Liquidation And Reactivation

A cluster is liquidatable if it is active and either:
- balance is below minimum liquidation collateral, or
- balance is below the required runway threshold:

```text
minimumBlocksBeforeLiquidation * (operator fees + network fee) * validatorCount
```

On liquidation:
- cluster is marked inactive
- cluster balance is zeroed
- remaining balance is transferred to the liquidator
- DAO validator count is reduced

On reactivation:
- only the cluster owner can do it
- the cluster must be inactive
- a deposit may be added
- operator and DAO counts and indexes are reinitialized
- post-reactivation balance must be above the liquidation threshold

### 4. Operator Interactions

Operators can:
- register or remove themselves
- switch between private and public mode
- manage whitelists
- declare fee changes subject to time windows and max-increase limits
- reduce fees immediately
- withdraw accrued operator earnings

Notable fee rule: an operator starting at fee `0` cannot later increase it.

### 5. DAO And Config Interactions

The DAO owner can:
- update module addresses
- upgrade `SSVNetwork` and `SSVNetworkViews`
- tune fee and liquidation parameters
- withdraw network earnings

Integrations should not hardcode module implementation addresses; the stable user-facing address is the proxy.

## ETH Vs Legacy SSV Behavior

For the verifier docs in this repository, `~/dev/ssv-network` represents the legacy SSV-token model only.

What is present there:
- SSV-token deposits and withdrawals via ERC-20 `transfer` and `transferFrom`
- SSV-denominated operator fees
- SSV-denominated network fee and DAO earnings
- cluster accounting scaled by `validatorCount`

What is not present there:
- separate ETH-cluster entrypoints
- `*SSV` suffixed parallel APIs
- effective-balance-based ETH accounting

When reconciling that repo with `ssv-protocol.md`, treat `~/dev/ssv-network` as the legacy SSV branch of the protocol model.

## Important Caveats For Coding Agents

- Always interact through `SSVNetwork` or `SSVNetworkViews`, not module contracts directly.
- Many state-mutating functions require the caller to provide the current cluster struct; stale inputs revert with `IncorrectClusterState`.
- `operatorIds` must be sorted and unique.
- Validator operator-set size is constrained to `4`, `7`, `10`, or `13`.
- Private operator authorization is checked only at validator registration time; changing whitelists does not retroactively affect existing validators.
- Whitelisting in `v1.2.0` has multiple mechanisms: bitmap-based internal whitelists, external ERC-165 whitelist contracts, and legacy compatibility through `operatorsWhitelist`.
- Cluster balance views and liquidatability are time-dependent because they extrapolate indexes to the current block.
- Liquidation pays the remaining cluster balance to the liquidator, not back to the cluster owner.
- Operator and network earnings are separate accounting buckets from cluster balances.
- Events are emitted from the proxied network context because writes use `delegatecall`.

## Likely Source Files And Directories

### Architecture And Docs

- `docs/architecture.md`
- `docs/roles.md`
- `docs/operators.md`
- `README.md`
- `CHANGELOG.md`
- `RELEASE_NOTES.md`

### Core Contracts

- `contracts/SSVNetwork.sol`
- `contracts/SSVNetworkViews.sol`
- `contracts/modules/`

### Key Libraries

- `contracts/libraries/SSVStorage.sol`
- `contracts/libraries/SSVStorageProtocol.sol`
- `contracts/libraries/ClusterLib.sol`
- `contracts/libraries/OperatorLib.sol`
- `contracts/libraries/ProtocolLib.sol`
- `contracts/libraries/ValidatorLib.sol`
- `contracts/libraries/Types.sol`

### Interfaces

- `contracts/interfaces/ISSVNetwork.sol`
- `contracts/interfaces/ISSVNetworkCore.sol`
- `contracts/interfaces/ISSVClusters.sol`
- `contracts/interfaces/ISSVOperators.sol`
- `contracts/interfaces/ISSVDAO.sol`
- `contracts/interfaces/ISSVViews.sol`

### Behavioral References In Tests

- `test/validators/`
- `test/operators/`
- `test/liquidate/`
- `test/dao/`
- `test/account/`
