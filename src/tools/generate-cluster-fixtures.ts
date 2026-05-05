import fs from "node:fs";
import path from "node:path";

import {
  FIXTURE_REPORT_PATH,
  FIXTURE_SCHEMA_VERSION,
  clusterFixtureSeeds,
  fixtureAssets,
  fixtureScenarios,
  type ClusterFixtureSeed,
} from "./cluster-fixture-seeds.js";

const FIXTURE_ROOT = path.join("test", "fixtures", "verify-cluster-mainnet");

interface SubgraphSnapshot {
  schemaVersion: number;
  network: "mainnet";
  clusterId: string;
  indexedBlockNumber: number;
  cluster: ClusterFixtureSeed["cluster"];
  operators: ClusterFixtureSeed["operators"];
  daoValues: ClusterFixtureSeed["daoValues"];
}

interface ViewsSnapshot {
  schemaVersion: number;
  network: "mainnet";
  clusterId: string;
  blockNumber: number;
  assetType: ClusterFixtureSeed["asset"];
  baseline: { status: "success" };
  reads: {
    getBalance: string;
    getBurnRate: string;
    isLiquidatable: boolean;
    getLiquidationThresholdPeriod: string;
    getMinimumLiquidationCollateral: string;
  };
}

interface ExpectedSnapshot {
  schemaVersion: number;
  provenance: ClusterFixtureSeed["provenance"];
  scenario: ClusterFixtureSeed["scenario"];
  asset: ClusterFixtureSeed["asset"];
  network: "mainnet";
  clusterId: string;
  verificationBlock: number;
  status: ClusterFixtureSeed["expectedStatus"];
  checks: Array<{
    name: string;
    kind: "input" | "derived" | "operational";
    status: "pass";
    reason: "matched";
    detail: string;
    localValue?: string;
    viewsValue?: string;
  }>;
  accountingDebug: {
    selectedAsset: ClusterFixtureSeed["asset"];
    intermediates: {
      currentBalance: string;
      burnRate: string;
      liquidationCollateral: string;
      liquidatable: boolean;
    };
  };
}

interface ManifestEntry {
  id: string;
  description: string;
  scenario: ClusterFixtureSeed["scenario"];
  asset: ClusterFixtureSeed["asset"];
  network: "mainnet";
  block: number;
  clusterId: string;
  provenance: ClusterFixtureSeed["provenance"];
  artifacts: {
    subgraph: string;
    views: string;
    expected: string;
  };
}

interface FixtureManifest {
  schemaVersion: number;
  generatedFor: "verify-cluster";
  network: "mainnet";
  fixtures: ManifestEntry[];
}

function validateSeed(seed: ClusterFixtureSeed): void {
  if (!fixtureScenarios.includes(seed.scenario)) {
    throw new Error(`Seed ${seed.id} declares unsupported scenario ${seed.scenario}`);
  }

  if (!fixtureAssets.includes(seed.asset)) {
    throw new Error(`Seed ${seed.id} declares unsupported asset ${seed.asset}`);
  }

  if (seed.provenance.report !== FIXTURE_REPORT_PATH) {
    throw new Error(
      `Seed ${seed.id} provenance.report drifted from authoritative report path; expected ${FIXTURE_REPORT_PATH}`,
    );
  }

  if (!seed.provenance.section) {
    throw new Error(`Seed ${seed.id} provenance.section is required`);
  }

  if (seed.expectedStatus !== "pass") {
    throw new Error(
      `Seed ${seed.id} declares unsupported expectedStatus ${seed.expectedStatus}; only "pass" is supported`,
    );
  }

  if (seed.cluster.feeAsset !== seed.asset) {
    throw new Error(`Seed ${seed.id} cluster.feeAsset must equal seed.asset`);
  }

  if (seed.cluster.id !== `${seed.cluster.owner}-${seed.cluster.operatorIds.join("-")}`) {
    throw new Error(`Seed ${seed.id} cluster.id is not canonical`);
  }
}

function buildSubgraphSnapshot(seed: ClusterFixtureSeed): SubgraphSnapshot {
  return {
    schemaVersion: FIXTURE_SCHEMA_VERSION,
    network: "mainnet",
    clusterId: seed.cluster.id,
    indexedBlockNumber: seed.block,
    cluster: seed.cluster,
    operators: seed.operators,
    daoValues: seed.daoValues,
  };
}

function buildViewsSnapshot(seed: ClusterFixtureSeed): ViewsSnapshot {
  return {
    schemaVersion: FIXTURE_SCHEMA_VERSION,
    network: "mainnet",
    clusterId: seed.cluster.id,
    blockNumber: seed.block,
    assetType: seed.asset,
    baseline: { status: "success" },
    reads: {
      getBalance: seed.views.balance,
      getBurnRate: seed.views.burnRate,
      isLiquidatable: seed.views.liquidatable,
      getLiquidationThresholdPeriod: seed.daoValues.liquidationThreshold,
      getMinimumLiquidationCollateral: seed.daoValues.minimumLiquidationCollateral,
    },
  };
}

function buildExpectedSnapshot(seed: ClusterFixtureSeed): ExpectedSnapshot {
  return {
    schemaVersion: FIXTURE_SCHEMA_VERSION,
    provenance: seed.provenance,
    scenario: seed.scenario,
    asset: seed.asset,
    network: "mainnet",
    clusterId: seed.cluster.id,
    verificationBlock: seed.block,
    status: seed.expectedStatus,
    checks: [
      {
        name: "clusterState",
        kind: "input",
        status: "pass",
        reason: "matched",
        detail: "Pinned subgraph cluster snapshot was usable on the ETH Views surface",
        localValue: seed.cluster.id,
      },
      {
        name: "assetType",
        kind: "input",
        status: "pass",
        reason: "matched",
        detail: `Subgraph asset type matched the on-chain ${seed.asset} Views surface`,
        localValue: seed.asset,
        viewsValue: seed.asset,
      },
      {
        name: "currentBalance",
        kind: "derived",
        status: "pass",
        reason: "matched",
        detail: `Derived balance matched pinned Views at block ${seed.block}`,
        localValue: seed.views.balance,
        viewsValue: seed.views.balance,
      },
      {
        name: "burnRate",
        kind: "derived",
        status: "pass",
        reason: "matched",
        detail: `Derived burn rate matched pinned Views at block ${seed.block}`,
        localValue: seed.views.burnRate,
        viewsValue: seed.views.burnRate,
      },
      {
        name: "liquidationCollateral",
        kind: "derived",
        status: "pass",
        reason: "matched",
        detail: `Derived liquidation collateral matched pinned Views inputs at block ${seed.block}`,
        localValue: seed.daoValues.minimumLiquidationCollateral,
        viewsValue: seed.daoValues.minimumLiquidationCollateral,
      },
      {
        name: "liquidatable",
        kind: "derived",
        status: "pass",
        reason: "matched",
        detail: `Derived liquidatable status matched pinned Views at block ${seed.block}`,
        localValue: String(seed.views.liquidatable),
        viewsValue: String(seed.views.liquidatable),
      },
    ],
    accountingDebug: {
      selectedAsset: seed.asset,
      intermediates: {
        currentBalance: seed.views.balance,
        burnRate: seed.views.burnRate,
        liquidationCollateral: seed.daoValues.minimumLiquidationCollateral,
        liquidatable: seed.views.liquidatable,
      },
    },
  };
}

function writeFile(targetPath: string, contents: unknown): void {
  fs.writeFileSync(targetPath, `${JSON.stringify(contents, null, 2)}\n`);
}

function rewriteFixtureRoot(entries: Array<{ seed: ClusterFixtureSeed; subgraph: SubgraphSnapshot; views: ViewsSnapshot; expected: ExpectedSnapshot }>): FixtureManifest {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true });

  const manifest: FixtureManifest = {
    schemaVersion: FIXTURE_SCHEMA_VERSION,
    generatedFor: "verify-cluster",
    network: "mainnet",
    fixtures: [],
  };

  for (const entry of entries) {
    const directory = path.join(FIXTURE_ROOT, entry.seed.id);
    fs.mkdirSync(directory, { recursive: true });
    writeFile(path.join(directory, "subgraph.json"), entry.subgraph);
    writeFile(path.join(directory, "views.json"), entry.views);
    writeFile(path.join(directory, "expected.json"), entry.expected);

    manifest.fixtures.push({
      id: entry.seed.id,
      description: entry.seed.description,
      scenario: entry.seed.scenario,
      asset: entry.seed.asset,
      network: "mainnet",
      block: entry.seed.block,
      clusterId: entry.seed.cluster.id,
      provenance: entry.seed.provenance,
      artifacts: {
        subgraph: path.posix.join(entry.seed.id, "subgraph.json"),
        views: path.posix.join(entry.seed.id, "views.json"),
        expected: path.posix.join(entry.seed.id, "expected.json"),
      },
    });
  }

  writeFile(path.join(FIXTURE_ROOT, "fixture-manifest.json"), manifest);

  return manifest;
}

export function generateClusterFixtures(): FixtureManifest {
  for (const seed of clusterFixtureSeeds) {
    validateSeed(seed);
  }

  const entries = clusterFixtureSeeds.map((seed) => ({
    seed,
    subgraph: buildSubgraphSnapshot(seed),
    views: buildViewsSnapshot(seed),
    expected: buildExpectedSnapshot(seed),
  }));

  return rewriteFixtureRoot(entries);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifest = generateClusterFixtures();
  console.log(`Wrote ${manifest.fixtures.length} fixture(s) under ${FIXTURE_ROOT}`);
}
