# SSV Verifier

Developer CLI for verifying SSV subgraph data against on-chain `Views` data.

## Requirements

- Node.js 20+

## Install

```bash
npm install
cp .env.example .env
```

Fill in the required RPC URLs and `Views` contract addresses in `.env`.

## Run

Use the CLI entrypoint with a runtime network selector:

```bash
npm run dev -- --network hoodi
npm run dev -- --network mainnet
npm run dev -- --network both
```

Run the network health check command:

```bash
npm run dev -- verify-network --network hoodi
npm run dev -- verify-network --network mainnet
```

Run the single-cluster verifier:

```bash
npm run dev -- verify-cluster --network hoodi --cluster 0xe8c927a1fa792eddefe23fda643a62e03f999830-5-6-7-523
npm run dev -- verify-cluster --network hoodi --cluster 0xe8c927a1fa792eddefe23fda643a62e03f999830-5-6-7-523 --output json
```

The `verify-cluster` command now checks cluster identity fields, derives the current cluster balance from subgraph accounting inputs, compares that value to `Views.getBalance(...)`, and verifies burn rate plus liquidation status against `Views`.
Use `--output json` to emit the same result set as structured JSON for automation.

Run the batch verifier for every cluster on one network:

```bash
npm run dev -- verify-clusters --network hoodi
npm run dev -- verify-clusters --network mainnet
```

Build the CLI:

```bash
npm run build
node dist/index.js --network hoodi
node dist/index.js verify-network --network hoodi
node dist/index.js verify-cluster --network hoodi --cluster 0xe8c927a1fa792eddefe23fda643a62e03f999830-5-6-7-523
node dist/index.js verify-cluster --network hoodi --cluster 0xe8c927a1fa792eddefe23fda643a62e03f999830-5-6-7-523 --output json
node dist/index.js verify-clusters --network hoodi
```

Run tests:

```bash
npm test
```
