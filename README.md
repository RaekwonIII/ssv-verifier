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

Build the CLI:

```bash
npm run build
node dist/index.js --network hoodi
node dist/index.js verify-network --network hoodi
```

Run tests:

```bash
npm test
```
