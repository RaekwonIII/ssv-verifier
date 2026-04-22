# SSV Protocol — Cluster Accounting

Core protocol constants and formulas for working with SSV Network clusters. This document is data-source agnostic — it describes **what** to calculate and what inputs are needed.

---

## Cluster Types

Two cluster types coexist on-chain. They are differentiated by which contract functions are used (base name for ETH, `*SSV` suffix for legacy):

| Property | ETH Cluster | SSV Cluster (legacy) |
|---|---|---|
| Fee currency | ETH (wei) | SSV tokens |
| Fee scaling | Effective balance | Validator count |
| Contract functions | `liquidate`, `isLiquidatable`, `getBalance`, etc. | `liquidateSSV`, `isLiquidatableSSV`, `getBalanceSSV`, etc. |
| Status | Current standard | Maintenance mode |

---

## Constants

| Constant | ETH Clusters | SSV Clusters |
|---|---|---|
| `PRECISION` | `100,000` (10^5) | `10,000,000` (10^7) |
| `SCALE` | `effective_balance / 32` | `validator_count` |

---

## Data Requirements

All formulas below require some combination of these inputs. How you source them (subgraph, direct RPC, indexer, etc.) is up to you.

### Per-cluster data
| Field | Description |
|---|---|
| `validatorCount` | Number of validators in the cluster |
| `networkFeeIndex` | Cluster's last-known network fee index snapshot |
| `index` | Cluster's last-known operator fee index snapshot |
| `active` | Whether the cluster is currently active (not liquidated) |
| `balance` | Cluster balance at last on-chain update |
| `effectiveBalance` | Total effective balance in wei (ETH clusters only, used for SCALE) |

### Per-operator data (for each operator in the cluster)
| Field (ETH) | Field (SSV) | Description |
|---|---|---|
| `fee` | `feeSSV` | Per-block fee charged by this operator |
| `feeIndex` | `feeIndexSSV` | Accumulated fee index (packed — see note below) |
| `feeIndexBlockNumber` | `feeIndexBlockNumberSSV` | Block number when feeIndex was last updated |

### Network-wide data (DAO/protocol values)
| Field (ETH) | Field (SSV) | Description |
|---|---|---|
| `networkFee` | `networkFeeSSV` | Per-block network fee |
| `networkFeeIndex` | `networkFeeIndexSSV` | Accumulated network fee index (packed) |
| `networkFeeIndexBlockNumber` | `networkFeeIndexBlockNumberSSV` | Block when networkFeeIndex was last updated |
| `liquidationThreshold` | `liquidationThresholdSSV` | Number of blocks of runway required to avoid liquidation |
| `minimumLiquidationCollateral` | `minimumLiquidationCollateralSSV` | Floor collateral amount |

### Index packing note

Index fields (`feeIndex`, `networkFeeIndex`, `cluster.index`, `cluster.networkFeeIndex`) may be stored in packed form depending on your data source. If packed, they must be multiplied by `PRECISION` before use in formulas. See your data source documentation for details.

---

## Formulas

All formulas use the same structure for both cluster types — only the fee fields, PRECISION, and SCALE differ. Choose the correct field set based on cluster type.

### Current Index

Extrapolates a fee index from a stored snapshot to the current block.

**Inputs:** `packed_base_index`, `fee`, `start_block`, `current_block`
**Output:** Fee index at `current_block`

```
current_index = (packed_base_index * PRECISION) + (current_block - start_block) * fee
```

### Current Cluster Balance

Computes real-time balance by subtracting fees consumed since last update.

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

total_current_indexes = operator_indexes + network_index
total_cluster_index = (cluster.index * PRECISION) + (cluster.networkFeeIndex * PRECISION)

index_delta = total_current_indexes - total_cluster_index
current_balance = max(0, cluster.balance - index_delta * SCALE)
```

### Burn Rate

Per-block cost for the entire cluster.

**Inputs:** Fees of all operators in the cluster, network fee, SCALE
**Output:** Cost per block in native units

```
operator_fees = SUM of fee for each operator in the cluster
burn_rate = (operator_fees + network.networkFee) * SCALE
```

### Liquidation Collateral

Minimum balance the cluster must maintain to avoid liquidation.

**Inputs:** `burn_rate`, `liquidationThreshold`, `minimumLiquidationCollateral`
**Output:** Minimum required balance

```
threshold = burn_rate * network.liquidationThreshold
liquidation_collateral = MAX(threshold, network.minimumLiquidationCollateral)
```

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
