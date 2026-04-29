export const FIXTURE_SCHEMA_VERSION = 1;
export const FIXTURE_REPORT_PATH = "docs/cluster-balance-validation-report.md";

export const fixtureScenarios = ["OK", "falsePositive"] as const;
export type FixtureScenario = typeof fixtureScenarios[number];

export const fixtureAssets = ["ETH"] as const;
export type FixtureAsset = typeof fixtureAssets[number];

export interface ClusterFixtureSeed {
  id: string;
  description: string;
  scenario: FixtureScenario;
  asset: FixtureAsset;
  provenance: {
    report: string;
    section: string;
  };
  block: number;
  cluster: {
    id: string;
    owner: string;
    operatorIds: string[];
    validatorCount: string;
    networkFeeIndex: string;
    index: string;
    active: boolean;
    balance: string;
    feeAsset: "ETH";
    effectiveBalance: string;
  };
  operators: Array<{
    id: string;
    fee: string;
    feeIndex: string;
    feeIndexBlockNumber: string;
  }>;
  daoValues: {
    networkFee: string;
    networkFeeIndex: string;
    networkFeeIndexBlockNumber: string;
    liquidationThreshold: string;
    minimumLiquidationCollateral: string;
  };
  views: {
    balance: string;
    burnRate: string;
    liquidatable: boolean;
  };
  expectedStatus: "pass";
}

export const clusterFixtureSeeds: ClusterFixtureSeed[] = [
  {
    id: "ok-eth-active",
    description: "Healthy mainnet ETH cluster with non-zero balance and zero burn rate",
    scenario: "OK",
    asset: "ETH",
    provenance: {
      report: FIXTURE_REPORT_PATH,
      section: "ok-eth-active",
    },
    block: 19_000_000,
    cluster: {
      id: "0x0000000000000000000000000000000000000aaa-1-2-3-4",
      owner: "0x0000000000000000000000000000000000000aaa",
      operatorIds: ["1", "2", "3", "4"],
      validatorCount: "1",
      networkFeeIndex: "0",
      index: "0",
      active: true,
      balance: "64",
      feeAsset: "ETH",
      effectiveBalance: "32",
    },
    operators: [
      { id: "1", fee: "0", feeIndex: "0", feeIndexBlockNumber: "19000000" },
      { id: "2", fee: "0", feeIndex: "0", feeIndexBlockNumber: "19000000" },
      { id: "3", fee: "0", feeIndex: "0", feeIndexBlockNumber: "19000000" },
      { id: "4", fee: "0", feeIndex: "0", feeIndexBlockNumber: "19000000" },
    ],
    daoValues: {
      networkFee: "0",
      networkFeeIndex: "0",
      networkFeeIndexBlockNumber: "19000000",
      liquidationThreshold: "1",
      minimumLiquidationCollateral: "1",
    },
    views: {
      balance: "64",
      burnRate: "0",
      liquidatable: false,
    },
    expectedStatus: "pass",
  },
  {
    id: "false-positive-eth-non-divisible",
    description:
      "Mainnet ETH cluster with non-32-divisible effective balance previously rejected by the legacy verifier",
    scenario: "falsePositive",
    asset: "ETH",
    provenance: {
      report: FIXTURE_REPORT_PATH,
      section: "false-positive-eth-non-divisible",
    },
    block: 19_500_000,
    cluster: {
      id: "0x0000000000000000000000000000000000000bbb-5-6-7-8",
      owner: "0x0000000000000000000000000000000000000bbb",
      operatorIds: ["5", "6", "7", "8"],
      validatorCount: "1",
      networkFeeIndex: "0",
      index: "0",
      active: true,
      balance: "100",
      feeAsset: "ETH",
      effectiveBalance: "65",
    },
    operators: [
      { id: "5", fee: "0", feeIndex: "0", feeIndexBlockNumber: "19500000" },
      { id: "6", fee: "0", feeIndex: "0", feeIndexBlockNumber: "19500000" },
      { id: "7", fee: "0", feeIndex: "0", feeIndexBlockNumber: "19500000" },
      { id: "8", fee: "0", feeIndex: "0", feeIndexBlockNumber: "19500000" },
    ],
    daoValues: {
      networkFee: "0",
      networkFeeIndex: "0",
      networkFeeIndexBlockNumber: "19500000",
      liquidationThreshold: "1",
      minimumLiquidationCollateral: "1",
    },
    views: {
      balance: "100",
      burnRate: "0",
      liquidatable: false,
    },
    expectedStatus: "pass",
  },
];
