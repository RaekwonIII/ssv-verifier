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

Most subgraph values are returned raw and can be used directly. Index fields are the exception — they are stored in packed form and must be multiplied by `PRECISION` before use in protocol formulas.

| Field | Must Multiply? | Factor |
|---|---|---|
| `cluster.index` | Yes | `PRECISION` |
| `cluster.networkFeeIndex` | Yes | `PRECISION` |
| `operator.feeIndex` | Yes | `PRECISION` |
| `operator.feeIndexSSV` | Yes | `PRECISION` |
| `daovalues.networkFeeIndex` | Yes | `PRECISION` |
| `daovalues.networkFeeIndexSSV` | Yes | `PRECISION` |
| All fee values | No | — |
| All balance values | No | — |
| All collateral values | No | — |
| All threshold values | No | — |

PRECISION values (see `ssv-protocol.md`):
- ETH clusters: `100,000` (10^5)
- SSV clusters: `10,000,000` (10^7)

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
operator_fees = [int(op["fee"]) for op in operators]
network_fee = int(dao["networkFee"])
effective_balance = int(cluster["effectiveBalance"])

scale = effective_balance // 32
burn_rate = (sum(operator_fees) + network_fee) * scale
```

### Example: Calculate current balance

```python
PRECISION_ETH = 100_000
current_block = 2435000

def current_index(packed_index, fee, index_block, current_block):
    return (packed_index * PRECISION_ETH) + (current_block - index_block) * fee

operator_indexes = sum(
    current_index(
        int(op["feeIndex"]),
        int(op["fee"]),
        int(op["feeIndexBlockNumber"]),
        current_block,
    )
    for op in operators
)

network_index = current_index(
    int(dao["networkFeeIndex"]),
    int(dao["networkFee"]),
    int(dao["networkFeeIndexBlockNumber"]),
    current_block,
)

cluster_index = int(cluster["index"]) * PRECISION_ETH
cluster_nfi = int(cluster["networkFeeIndex"]) * PRECISION_ETH
total_current = operator_indexes + network_index
total_cluster = cluster_index + cluster_nfi
index_delta = total_current - total_cluster

scale = int(cluster["effectiveBalance"]) // 32
current_balance = max(0, int(cluster["balance"]) - index_delta * scale)
```

### Example: Calculate liquidation collateral

```python
liquidation_threshold = int(dao["liquidationThreshold"])
min_collateral = int(dao["minimumLiquidationCollateral"])

threshold = burn_rate * liquidation_threshold
liquidation_collateral = max(threshold, min_collateral)
```
