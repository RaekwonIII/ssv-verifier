# SSV Subgraph

Data source for fetching SSV Network cluster, operator, and network state. This document covers query patterns, field mappings, and data handling specific to the SSV subgraph. For protocol formulas, see `ssv-protocol.md`.

## API Endpoints

Always try the primary endpoint first. Fall back to the authenticated endpoint only if the primary fails or returns a rate limit error.

### Primary (public, no auth required)

| Network | URL |
|---|---|
| Mainnet | `https://api.studio.thegraph.com/query/71118/ssv-network-ethereum/version/latest` |
| Hoodi (testnet) | `https://api.studio.thegraph.com/query/71118/ssv-network-hoodi/version/latest` |

### Fallback (authenticated, requires API key)

API key must be stored in `.env` as `THEGRAPH_API_KEY` — never hardcode it.
URL format: `https://gateway.thegraph.com/api/{THEGRAPH_API_KEY}/subgraphs/id/{SUBGRAPH_ID}`

| Network | Subgraph ID |
|---|---|
| Mainnet | `7V45fKPugp9psQjgrGsfif98gWzCyC6ChN7CW98VyQnr` |
| Hoodi (testnet) | `F4AU5vPCuKfHvnLsusibxJEiTN7ELCoYTvnzg3YHGYbh` |

### Fallback Logic

```
try:
    response = query(primary_url)
    if response is rate_limited or failed:
        raise error
    return response
except:
    return query(fallback_url_with_api_key)
```

Send all queries as HTTP POST with `Content-Type: application/json` and body `{ "query": "..." }`.

---

## Schema

Full schema is in `claude-refs/repos/subgraph-mainnet/schema.graphql` or `subgraph-hoodi/schema.graphql`.
Use the schema to derive field names and types. The sections below document usage patterns and gotchas only.

---

## Key Queries

### Clusters (paginated)

```graphql
query($skip: Int!) {
    clusters(first: 1000, skip: $skip) {
        id
        owner { id }
        operatorIds
        validatorCount
        networkFeeIndex
        index
        active
        balance
        feeAsset
        effectiveBalance
    }
}
```

- `feeAsset`: `"ETH"` or `"SSV"` — subgraph convenience field indicating cluster type. Determines which formula constants (`PRECISION`, `SCALE`) and which contract function variants to use. This field exists only in the subgraph, not on-chain.
- `effectiveBalance`: total effective balance in whole ETH (e.g. `"64"` = 64 ETH), only meaningful for ETH clusters
- `owner`: returned as nested object `{ id: "0x..." }` — extract the `id` field for the address

### Single Cluster

```graphql
query($id: ID!) {
    cluster(id: $id) {
        id
        owner { id }
        operatorIds
        validatorCount
        networkFeeIndex
        index
        active
        balance
        feeAsset
        effectiveBalance
    }
}
```

Use this to fetch fresh state for a specific cluster before performing on-chain actions. The cluster ID format is described below.

### Operators (paginated)

```graphql
query($skip: Int!) {
    operators(first: 1000, skip: $skip) {
        id
        fee
        feeIndex
        feeIndexBlockNumber
        feeSSV
        feeIndexSSV
        feeIndexBlockNumberSSV
    }
}
```

### Network Config (single lookup, no pagination)

```graphql
query {
    daovalues(id: "<DAO_CONTRACT_ADDRESS>") {
        networkFee
        networkFeeIndex
        networkFeeIndexBlockNumber
        liquidationThreshold
        minimumLiquidationCollateral
        networkFeeSSV
        networkFeeIndexSSV
        networkFeeIndexBlockNumberSSV
        liquidationThresholdSSV
        minimumLiquidationCollateralSSV
    }
}
```

DAO contract addresses (same as SSVNetwork contract):
- Mainnet: `0xDD9BC35aE942eF0cFa76930954a156B3fF30a4E1`
- Hoodi: `0x58410Bef803ECd7E63B23664C586A6DB72DAf59c`

### Subgraph Meta (current indexed block)

```graphql
query {
    _meta {
        block { number }
    }
}
```

Use this to check how far behind the subgraph is relative to the chain head. Useful for `last updated` indicators.

---

## Pagination Pattern

For clusters and operators:
1. Start with `skip = 0`
2. Fetch batch with `first: 1000, skip: $skip`
3. If result is empty or fewer than 1000 items, stop
4. Otherwise increment `skip += 1000` and fetch next batch

---

## Cluster ID Format

Cluster IDs in the subgraph follow this format: `{ownerAddress}-{op1}-{op2}-{op3}-{op4}`
- Owner address must be lowercased
- Operator IDs sorted ascending

Example: `0xe8c927a1fa792eddefe23fda643a62e03f999830-5-6-7-523`

---

## Type Handling

### BigInt fields are strings

The subgraph returns all numeric fields (balances, indexes, fees, counts) as strings, not integers. Convert to your language's integer type before performing calculations.

Example (Python):
```python
cluster_tuple = (
    int(cluster["validatorCount"]),
    int(cluster["networkFeeIndex"]),
    int(cluster["index"]),
    bool(cluster["active"]),
    int(cluster["balance"]),
)
```

### `operatorIds` are strings

The `operatorIds` field returns an array of strings: `["503", "504", "505", "528"]`. Convert to integers before passing to contract functions:

```python
operator_ids = [int(op) for op in cluster["operatorIds"]]
```

### `owner` is nested

The `owner` field returns `{ "id": "0xae9b..." }`. Extract the address:

```python
owner_address = cluster["owner"]["id"]
```

---

## Index Field Packing

Most subgraph values are returned raw and can be used directly. The fee-index fields need a small adjustment to line up with the on-chain `uint64` accumulators.

The contract stores `cluster.index`, `cluster.networkFeeIndex`, `operator.snapshot.index`, and the protocol-level `networkFeeIndex` as **packed `uint64` accumulators** that grow each block by `(blockDelta * packed_fee)`, where `packed_fee = unpacked_fee / DEDUCTED_DIGITS`.

The subgraph mirrors the contract for `cluster.*` fields, but it accumulates `operator.feeIndex(SSV)` and `daovalues.networkFeeIndex(SSV)` in **unpacked** space (`feeIndex += blockDelta * unpacked_fee`). To combine the two consistently, divide the unpacked values by `DEDUCTED_DIGITS` (or pack the fee instead — same result).

| Field | Storage form (subgraph) | To use with packed `cluster.*` indices |
|---|---|---|
| `cluster.index` | packed `uint64` (raw from event) | use as-is |
| `cluster.networkFeeIndex` | packed `uint64` (raw from event) | use as-is |
| `operator.feeIndex`, `operator.feeIndexSSV` | unpacked accumulator | divide by `DEDUCTED_DIGITS` |
| `daovalues.networkFeeIndex`, `daovalues.networkFeeIndexSSV` | unpacked accumulator | divide by `DEDUCTED_DIGITS` |
| All fee values | unpacked, native units per block | pack with `/ DEDUCTED_DIGITS` when accumulating |
| All balance / collateral / threshold values | unpacked native units | use as-is |

`DEDUCTED_DIGITS` values (see `ssv-protocol.md`):
- ETH clusters: `100,000` (10^5)
- SSV clusters: `10,000,000` (10^7)

Note that older versions of this guide instructed callers to multiply *every* index field by `PRECISION`. That over-inflates the operator and DAO indices because the subgraph already accumulates them in unpacked space. Mixing the two conventions silently produces large negative balances on clusters whose operator `feeIndex` is non-zero.

---

## Subgraph Lag

The subgraph indexes blocks with a delay and may be a few blocks behind the chain head. This means:
- Freshly created or reactivated clusters may not appear immediately
- Recently liquidated clusters may still show as active
- Balance and index snapshots may be slightly stale

---

## Calculation Examples Using Subgraph Data

These examples show how to fetch data from the subgraph and compute cluster metrics using the formulas from `ssv-protocol.md`.
All examples assume an ETH cluster. For SSV clusters, substitute the SSV field variants and constants.

### Setup: Fetch all required data

To compute metrics for a single cluster, you need three queries:

```graphql
query {
    cluster(id: "0xae9b20a32bd5df452b1fcc0e4ff7d36dd786aad5-503-504-505-528") {
        id
        owner { id }
        operatorIds
        validatorCount
        networkFeeIndex
        index
        active
        balance
        feeAsset
        effectiveBalance
    }
}
```

```graphql
query {
    operators(where: { id_in: ["503", "504", "505", "528"] }) {
        id
        fee
        feeIndex
        feeIndexBlockNumber
    }
}
```

```graphql
query {
    daovalues(id: "0x58410bef803ecd7e63b23664c586a6db72daf59c") {
        networkFee
        networkFeeIndex
        networkFeeIndexBlockNumber
        liquidationThreshold
        minimumLiquidationCollateral
    }
}
```

You also need the current block number from RPC or subgraph `_meta`.

### Example: Calculate burn rate

```python
DEDUCTED_DIGITS_ETH = 100_000
VUNITS_PRECISION = 10_000
ETH_VALIDATOR_CAPACITY = 32

def eb_to_vunits(eb):
    scaled = eb * VUNITS_PRECISION
    return 0 if scaled == 0 else (scaled - 1) // ETH_VALIDATOR_CAPACITY + 1

operator_fees = [int(op["fee"]) for op in operators]
network_fee = int(dao["networkFee"])
v_units = eb_to_vunits(int(cluster["effectiveBalance"]))

burn_rate = ((sum(operator_fees) + network_fee) * v_units) // VUNITS_PRECISION
```

### Example: Calculate current balance

```python
DEDUCTED_DIGITS_ETH = 100_000
VUNITS_PRECISION = 10_000
ETH_VALIDATOR_CAPACITY = 32
current_block = 2_435_000

def eb_to_vunits(eb):
    scaled = eb * VUNITS_PRECISION
    return 0 if scaled == 0 else (scaled - 1) // ETH_VALIDATOR_CAPACITY + 1

def packed_current_index(unpacked_base, unpacked_fee, base_block, current_block):
    """Project an unpacked operator/DAO index into the contract's packed uint64 space."""
    packed_base = unpacked_base // DEDUCTED_DIGITS_ETH
    packed_fee = unpacked_fee // DEDUCTED_DIGITS_ETH
    return packed_base + (current_block - base_block) * packed_fee

operator_indexes = sum(
    packed_current_index(
        int(op["feeIndex"]),
        int(op["fee"]),
        int(op["feeIndexBlockNumber"]),
        current_block,
    )
    for op in operators
)

network_index = packed_current_index(
    int(dao["networkFeeIndex"]),
    int(dao["networkFee"]),
    int(dao["networkFeeIndexBlockNumber"]),
    current_block,
)

cluster_index = int(cluster["index"])               # already packed (raw uint64)
cluster_nfi = int(cluster["networkFeeIndex"])       # already packed (raw uint64)
operator_delta = operator_indexes - cluster_index
network_delta = network_index - cluster_nfi

v_units = eb_to_vunits(int(cluster["effectiveBalance"]))

# Floor each delta independently before expanding — the contract does the same.
operator_usage_units = (operator_delta * v_units) // VUNITS_PRECISION
network_usage_units = (network_delta * v_units) // VUNITS_PRECISION
balance_delta = (operator_usage_units + network_usage_units) * DEDUCTED_DIGITS_ETH

current_balance = int(cluster["balance"]) - balance_delta
```

For SSV clusters, replace the `vUnits / VUNITS_PRECISION` scaling with `cluster.validatorCount` and use `DEDUCTED_DIGITS_SSV = 10_000_000`. The packed/unpacked index split is the same (`cluster.index` packed, `operator.feeIndexSSV` / `daovalues.networkFeeIndexSSV` unpacked).

### Example: Calculate liquidation collateral

```python
liquidation_threshold = int(dao["liquidationThreshold"])
min_collateral = int(dao["minimumLiquidationCollateral"])

threshold = burn_rate * liquidation_threshold
liquidation_collateral = max(threshold, min_collateral)
```
