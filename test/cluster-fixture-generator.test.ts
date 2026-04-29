import fs from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  FIXTURE_REPORT_PATH,
  FIXTURE_SCHEMA_VERSION,
  clusterFixtureSeeds,
} from "../src/tools/cluster-fixture-seeds.js";
import { generateClusterFixtures } from "../src/tools/generate-cluster-fixtures.js";

const FIXTURE_ROOT = path.join("test", "fixtures", "verify-cluster-mainnet");

describe("cluster fixture generator", () => {
  afterAll(() => {
    generateClusterFixtures();
  });

  it("rewrites the mainnet fixture root from authoritative seeds", () => {
    const stalePath = path.join(FIXTURE_ROOT, "stale-fixture");
    fs.mkdirSync(stalePath, { recursive: true });
    fs.writeFileSync(path.join(stalePath, "stray.json"), "{}\n");

    const manifest = generateClusterFixtures();

    expect(manifest.schemaVersion).toBe(FIXTURE_SCHEMA_VERSION);
    expect(manifest.network).toBe("mainnet");
    expect(manifest.fixtures.map((entry) => entry.id)).toEqual(
      clusterFixtureSeeds.map((seed) => seed.id),
    );
    expect(fs.existsSync(stalePath)).toBe(false);
    expect(fs.readdirSync(FIXTURE_ROOT).sort()).toEqual([
      "false-positive-eth-non-divisible",
      "fixture-manifest.json",
      "ok-eth-active",
    ]);
  });

  it("writes pinned subgraph/views/expected artifacts with provenance and schema", () => {
    generateClusterFixtures();

    for (const seed of clusterFixtureSeeds) {
      const directory = path.join(FIXTURE_ROOT, seed.id);
      const subgraph = JSON.parse(fs.readFileSync(path.join(directory, "subgraph.json"), "utf8"));
      const views = JSON.parse(fs.readFileSync(path.join(directory, "views.json"), "utf8"));
      const expected = JSON.parse(fs.readFileSync(path.join(directory, "expected.json"), "utf8"));

      expect(subgraph.schemaVersion).toBe(FIXTURE_SCHEMA_VERSION);
      expect(subgraph.indexedBlockNumber).toBe(seed.block);
      expect(subgraph.cluster.id).toBe(seed.cluster.id);

      expect(views.schemaVersion).toBe(FIXTURE_SCHEMA_VERSION);
      expect(views.blockNumber).toBe(seed.block);
      expect(views.assetType).toBe(seed.asset);

      expect(expected.schemaVersion).toBe(FIXTURE_SCHEMA_VERSION);
      expect(expected.provenance.report).toBe(FIXTURE_REPORT_PATH);
      expect(expected.scenario).toBe(seed.scenario);
      expect(expected.status).toBe("pass");
      expect(expected.checks.map((check: { name: string }) => check.name)).toEqual([
        "clusterState",
        "assetType",
        "currentBalance",
        "burnRate",
        "liquidationCollateral",
        "liquidatable",
      ]);
      expect(expected.accountingDebug.selectedAsset).toBe(seed.asset);
    }
  });

  it("fails fast when a seed declares unsupported scenario", async () => {
    const seedsModule = await import("../src/tools/cluster-fixture-seeds.js");
    const original = seedsModule.clusterFixtureSeeds[0]!;
    const broken = { ...original, scenario: "made-up" as never };

    seedsModule.clusterFixtureSeeds.splice(0, 1, broken);

    try {
      expect(() => generateClusterFixtures()).toThrow(/unsupported scenario/);
    } finally {
      seedsModule.clusterFixtureSeeds.splice(0, 1, original);
    }
  });
});
