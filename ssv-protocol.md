# SSV Protocol — Cluster Accounting

Core protocol constants and formulas for working with SSV Network clusters. This document is data-source agnostic — it describes **what** to calculate and what inputs are needed.

---

## Cluster Types

Two cluster types coexist on-chain. They are differentiated by which contract functions are used (base name for ETH, `*SSV` suffix for legacy):

| Property | ETH Cluster | SSV Cluster (legacy) |
|---|---|---|
| Fee currency | ETH (wei) | SSV tokens |
| Fee scaling | `vUnits` (derived from effective balance, see below) | Validator count |
| Contract functions | `liquidate`, `isLiquidatable`, `getBalance`, etc. | `liquidateSSV`, `isLiquidatableSSV`, `getBalanceSSV`, etc. |
| Status | Current standard (post-staking-update) | Maintenance mode |

---

## Constants

| Constant | ETH Clusters | SSV Clusters |
|---|---|---|
| `DEDUCTED_DIGITS` | `100,000` (10^5) | `10,000,000` (10^7) |
| `VUNITS_PRECISION` | `10,000` | _(n/a)_ |
| `ETH_VALIDATOR_CAPACITY` | `32` | _(n/a)_ |

`DEDUCTED_DIGITS` is the on-chain packing factor for fees (operator and network) and for the final balance/burn-rate expansion. Anything stored as a `PackedETH` / `PackedSSV` `uint64` is the raw uint × `DEDUCTED_DIGITS` once unpacked.

`VUNITS_PRECISION` and `ETH_VALIDATOR_CAPACITY` only show up on the ETH path. They are used to derive a per-cluster `vUnits` value that takes the place of the legacy `effective_balance / 32` SCALE.

### Computing `vUnits` (ETH only)

```
vUnits = ceil(effective_balance * VUNITS_PRECISION / ETH_VALIDATOR_CAPACITY)
```

The ceiling matters when `effective_balance` is not a multiple of 32 — non-divisible balances pick up a one-unit rounding bump that the contract uses to avoid under-charging. The contract may also override `vUnits` with a per-cluster stored value when an explicit effective-balance update was applied; if your data source does not expose that override, treat `vUnits = ebToVUnits(effective_balance)` as the default.

---

## Data Requirements

All formulas below require some combination of these inputs. How you source them (subgraph, direct RPC, indexer, etc.) is up to you.

### Per-cluster data
| Field | Description |
|---|---|
| `validatorCount` | Number of validators in the cluster |
| `networkFeeIndex` | Cluster's last-known network fee index snapshot (packed, raw `uint64` from the contract) |
| `index` | Cluster's last-known operator fee index snapshot (packed, raw `uint64`) |
| `active` | Whether the cluster is currently active (not liquidated) |
| `balance` | Cluster balance at last on-chain update, in native units (wei or SSV-wei) |
| `effectiveBalance` | Total effective balance in whole ETH (e.g. `64`), ETH clusters only |

### Per-operator data (for each operator in the cluster)
| Field (ETH) | Field (SSV) | Description |
|---|---|---|
| `fee` | `feeSSV` | Per-block fee charged by this operator (unpacked, native units per block) |
| `feeIndex` | `feeIndexSSV` | Accumulated fee index (see *Index storage form* below) |
| `feeIndexBlockNumber` | `feeIndexBlockNumberSSV` | Block when feeIndex was last updated |

### Network-wide data (DAO/protocol values)
| Field (ETH) | Field (SSV) | Description |
|---|---|---|
| `networkFee` | `networkFeeSSV` | Per-block network fee (unpacked) |
| `networkFeeIndex` | `networkFeeIndexSSV` | Accumulated network fee index (see *Index storage form* below) |
| `networkFeeIndexBlockNumber` | `networkFeeIndexBlockNumberSSV` | Block when networkFeeIndex was last updated |
| `liquidationThreshold` | `liquidationThresholdSSV` | Number of blocks of runway required to avoid liquidation |
| `minimumLiquidationCollateral` | `minimumLiquidationCollateralSSV` | Floor collateral amount |

### Index storage form

The on-chain `cluster.index` and `cluster.networkFeeIndex` are stored as **packed `uint64` accumulators** that grow by `(blockDelta * packed_fee)` each tick, where `packed_fee = unpacked_fee / DEDUCTED_DIGITS`.

How operator and DAO fee indices are presented depends on the data source:

- **Contract storage**: `operator.snapshot.index` and the protocol-level `networkFeeIndex` follow the same packed `uint64` accumulator semantics as `cluster.index`.
- **SSV subgraph (and similar indexers)**: `operator.feeIndex` / `operator.feeIndexSSV` and `daovalues.networkFeeIndex(SSV)` are accumulated using the **unpacked** fee value (`feeIndex += blockDelta * unpacked_fee`). They are therefore in *unpacked* space and must be divided by `DEDUCTED_DIGITS` (or, equivalently, the fee must be packed) before they can be combined with the packed `cluster.*` indices.

`cluster.index` and `cluster.networkFeeIndex` always come from event params and stay in *packed* form regardless of source.

If your data source documents a different convention, consult that source — but keep the packed/unpacked split in mind: combining indices that live in different spaces silently produces wildly wrong balances.

---

## Formulas

All formulas use the same structure for both cluster types — only the fee fields, scaling, and packing rules differ. Choose the correct field set based on cluster type.

### Current Index

Extrapolates a fee index from a stored snapshot to the current block, expressed in **packed (`uint64`)** space — the form `cluster.index` and `cluster.networkFeeIndex` are stored in.

**Inputs:** `base_index`, `fee` (unpacked, per block), `start_block`, `current_block`
**Output:** Packed index at `current_block`

```
packed_base = base_index_in_packed_form    # cluster.index, cluster.networkFeeIndex
            OR base_index_in_unpacked_form / DEDUCTED_DIGITS
                                            # operator.feeIndex, daovalues.networkFeeIndex
                                            # (when the data source returns them unpacked)

packed_fee = fee / DEDUCTED_DIGITS

current_index = packed_base + (current_block - start_block) * packed_fee
```

### Current Cluster Balance

Computes real-time balance by subtracting fees consumed since the last on-chain update.

**Inputs:** Cluster data, all operator data for the cluster, network data, `current_block`
**Output:** Current balance in native units (wei for ETH, SSV-wei for SSV)

```
For each operator in the cluster:
    operator_current_index = current_index(op.feeIndex, op.fee, op.feeIndexBlockNumber, current_block)

operator_indexes = SUM of all operator_current_index values

network_index = current_index(
    network.networkFeeIndex,
    network.networkFee,
    network.networkFeeIndexBlockNumber,
    current_block
)

operator_index_delta = operator_indexes - cluster.index
network_index_delta  = network_index    - cluster.networkFeeIndex

# ETH path: scale each delta by vUnits with floor division per delta, then expand
if ETH:
    operator_usage_units = floor(operator_index_delta * vUnits / VUNITS_PRECISION)
    network_usage_units  = floor(network_index_delta  * vUnits / VUNITS_PRECISION)
    usage_units = operator_usage_units + network_usage_units
    balance_delta = usage_units * DEDUCTED_DIGITS_ETH

# SSV path: scale by validator count (no per-delta truncation)
if SSV:
    balance_delta = (operator_index_delta + network_index_delta) * cluster.validatorCount * DEDUCTED_DIGITS_SSV
                                            # equivalently: scale unpacked deltas by validatorCount

current_balance = cluster.balance - balance_delta
```

The contract floors each scaled delta independently before summing. Folding `operator_index_delta + network_index_delta` first and scaling once produces a slightly different result on non-divisible effective balances; match the contract by keeping the two terms separate.

### Burn Rate

Per-block cost for the entire cluster, expressed in native units per block.

**Inputs:** Fees of all operators in the cluster, network fee, scaling
**Output:** Cost per block in native units

```
total_fee_rate = SUM of operator fees + network.networkFee     # all unpacked

if ETH:
    burn_rate = floor(total_fee_rate * vUnits / VUNITS_PRECISION)
if SSV:
    burn_rate = total_fee_rate * cluster.validatorCount
```

### Liquidation Collateral

Minimum balance the cluster must maintain to avoid liquidation.

**Inputs:** `burn_rate`, `liquidationThreshold`, `minimumLiquidationCollateral`
**Output:** Minimum required balance

```
threshold = burn_rate * network.liquidationThreshold
liquidation_collateral = MAX(threshold, network.minimumLiquidationCollateral)
```

### Liquidatable

```
liquidatable =
    cluster.active
    AND cluster.validatorCount > 0
    AND current_balance < liquidation_collateral
```

The `validatorCount > 0` short-circuit matches the contract's `isLiquidatable`, which always returns `false` for empty clusters regardless of balance.

### Runway

How many blocks until the cluster hits the liquidation threshold.

**Inputs:** `current_balance`, `liquidation_collateral`, `burn_rate`
**Output:** Blocks remaining (or Infinite if burn_rate is 0)

```
if burn_rate == 0:
    return { blocks: "Infinite", days: "Infinite" }

available_balance = current_balance - liquidation_collateral

if available_balance <= 0:
    return { blocks: 0, days: 0 }

blocks = (available_balance // burn_rate) + 1
days = blocks // 7200        # ~12s per block → 7200 blocks/day
```

### Cluster Hash

Deterministic hash used for on-chain cluster identification.

**Inputs:** `owner` (address), `operatorIds` (list of integers)
**Output:** keccak256 hash

```
1. Strip "0x" from owner address
2. For each operator ID (decimal):
   - Convert to hex
   - Pad to 64 hex characters (32 bytes)
3. Concatenate: owner_hex + all_operator_hexes
4. keccak256 hash of combined hex string
5. Return hash with "0x" prefix
```

---

## Display Conventions

When presenting SSV data in user interfaces:

### Hex truncation
All hex strings (addresses, cluster hashes, tx hashes) should be truncated as: `0x1234...5678` (4 chars after `0x` + last 4 chars). Show full value on hover/tooltip and provide a copy button.

### Explorer links
All displayed hex values should be clickable links to the appropriate block explorer:

| Type | Mainnet | Hoodi |
|---|---|---|
| Cluster | `https://explorer.ssv.network/mainnet/cluster/{id}` | `https://explorer.hoodi.ssv.network/hoodi/cluster/{id}` |
| Account | `https://explorer.ssv.network/mainnet/account/{address}` | `https://explorer.hoodi.ssv.network/hoodi/account/{address}` |
| Transaction | `https://etherscan.io/tx/{hash}` | `https://hoodi.etherscan.io/tx/{hash}` |
