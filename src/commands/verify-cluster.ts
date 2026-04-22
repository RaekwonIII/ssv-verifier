import type { RuntimeConfig } from "../config/env.js";
import type { SingleNetwork } from "../config/networks.js";
import { fetchSubgraphCluster } from "../clients/subgraph.js";
import { validateClusterStateWithViews, type ViewsClusterState } from "../clients/views.js";

export type CheckStatus = "pass" | "fail";

export interface ClusterIdentityCheckResult {
  name: "owner" | "operatorIds" | "validatorCount" | "active";
  status: CheckStatus;
  detail: string;
  subgraphValue: string;
}

export interface VerifyClusterResult {
  network: SingleNetwork;
  clusterId: string;
  subgraphSource: "primary" | "fallback";
  status: CheckStatus;
  checks: ClusterIdentityCheckResult[];
}

export interface VerifyClusterDependencies {
  fetchFn?: typeof fetch;
}

interface NormalizedCluster {
  id: string;
  owner: string;
  operatorIds: bigint[];
  validatorCount: number;
  networkFeeIndex: bigint;
  index: bigint;
  active: boolean;
  balance: bigint;
}

function normalizeClusterValue(cluster: {
  id: string;
  owner: { id: string };
  operatorIds: string[];
  validatorCount: string;
  networkFeeIndex: string;
  index: string;
  active: boolean;
  balance: string;
}): NormalizedCluster {
  return {
    id: cluster.id,
    owner: cluster.owner.id.toLowerCase(),
    operatorIds: cluster.operatorIds.map((operatorId) => BigInt(operatorId)),
    validatorCount: Number.parseInt(cluster.validatorCount, 10),
    networkFeeIndex: BigInt(cluster.networkFeeIndex),
    index: BigInt(cluster.index),
    active: cluster.active,
    balance: BigInt(cluster.balance),
  };
}

function toViewsClusterState(cluster: NormalizedCluster): ViewsClusterState {
  return {
    validatorCount: cluster.validatorCount,
    networkFeeIndex: cluster.networkFeeIndex,
    index: cluster.index,
    active: cluster.active,
    balance: cluster.balance,
  };
}

function mutateAddress(address: string): string {
  const value = BigInt(address);
  const mutated = (value + 1n) % (1n << 160n);
  return `0x${mutated.toString(16).padStart(40, "0")}`;
}

function mutateOperatorIds(operatorIds: bigint[]): bigint[] {
  if (operatorIds.length === 0) {
    return [1n];
  }

  const mutated = [...operatorIds];
  const lastIndex = mutated.length - 1;
  mutated[lastIndex] = mutated[lastIndex]! + 1n;
  return mutated;
}

function formatOperatorIds(operatorIds: bigint[]): string {
  return operatorIds.map((operatorId) => operatorId.toString()).join(", ");
}

function createFailureCheck(
  name: ClusterIdentityCheckResult["name"],
  subgraphValue: string,
  detail: string,
): ClusterIdentityCheckResult {
  return {
    name,
    status: "fail",
    subgraphValue,
    detail,
  };
}

async function runMutationCheck(
  name: ClusterIdentityCheckResult["name"],
  subgraphValue: string,
  validator: () => Promise<{ status: "success" | "revert"; detail: string }>,
): Promise<ClusterIdentityCheckResult> {
  const result = await validator();

  if (result.status === "revert") {
    return {
      name,
      status: "pass",
      subgraphValue,
      detail: `Subgraph value matched the Views-validated state; altered input was rejected (${result.detail})`,
    };
  }

  return {
    name,
    status: "fail",
    subgraphValue,
    detail: `Views also accepted an altered ${name} value, so the match could not be proven`,
  };
}

export async function verifyClusterIdentity(
  config: RuntimeConfig,
  clusterId: string,
  dependencies: VerifyClusterDependencies = {},
): Promise<VerifyClusterResult> {
  if (config.activeNetworks.length !== 1) {
    throw new Error("verify-cluster requires a single network target, not --network both.");
  }

  const fetchFn = dependencies.fetchFn ?? fetch;
  const network = config.activeNetworks[0]!;
  const networkConfig = config.networks[network];
  const subgraphCluster = await fetchSubgraphCluster(
    networkConfig.subgraphPrimaryUrl,
    networkConfig.subgraphFallbackUrl,
    clusterId,
    fetchFn,
  );
  const cluster = normalizeClusterValue(subgraphCluster.cluster);
  const baseline = await validateClusterStateWithViews(
    networkConfig.rpcUrl,
    networkConfig.viewsAddress,
    cluster.owner,
    cluster.operatorIds,
    toViewsClusterState(cluster),
    fetchFn,
  );

  const baselineFailure = `Views rejected the subgraph cluster state: ${baseline.detail}`;

  const checks = baseline.status === "revert"
    ? [
        createFailureCheck("owner", cluster.owner, baselineFailure),
        createFailureCheck("operatorIds", formatOperatorIds(cluster.operatorIds), baselineFailure),
        createFailureCheck("validatorCount", String(cluster.validatorCount), baselineFailure),
        createFailureCheck("active", String(cluster.active), baselineFailure),
      ]
    : await Promise.all([
        runMutationCheck("owner", cluster.owner, () =>
          validateClusterStateWithViews(
            networkConfig.rpcUrl,
            networkConfig.viewsAddress,
            mutateAddress(cluster.owner),
            cluster.operatorIds,
            toViewsClusterState(cluster),
            fetchFn,
          ),
        ),
        runMutationCheck("operatorIds", formatOperatorIds(cluster.operatorIds), () =>
          validateClusterStateWithViews(
            networkConfig.rpcUrl,
            networkConfig.viewsAddress,
            cluster.owner,
            mutateOperatorIds(cluster.operatorIds),
            toViewsClusterState(cluster),
            fetchFn,
          ),
        ),
        runMutationCheck("validatorCount", String(cluster.validatorCount), () =>
          validateClusterStateWithViews(
            networkConfig.rpcUrl,
            networkConfig.viewsAddress,
            cluster.owner,
            cluster.operatorIds,
            {
              ...toViewsClusterState(cluster),
              validatorCount: cluster.validatorCount + 1,
            },
            fetchFn,
          ),
        ),
        runMutationCheck("active", String(cluster.active), () =>
          validateClusterStateWithViews(
            networkConfig.rpcUrl,
            networkConfig.viewsAddress,
            cluster.owner,
            cluster.operatorIds,
            {
              ...toViewsClusterState(cluster),
              active: !cluster.active,
            },
            fetchFn,
          ),
        ),
      ]);

  return {
    network,
    clusterId: cluster.id,
    subgraphSource: subgraphCluster.source,
    status: checks.every((check) => check.status === "pass") ? "pass" : "fail",
    checks,
  };
}

export function renderVerifyClusterSummary(result: VerifyClusterResult): string {
  const lines = [
    `verify-cluster ${result.status.toUpperCase()}`,
    `network: ${result.network}`,
    `cluster: ${result.clusterId}`,
    `subgraph source: ${result.subgraphSource}`,
  ];

  for (const check of result.checks) {
    lines.push(`- ${check.name}: ${check.status.toUpperCase()} (subgraph=${check.subgraphValue}; ${check.detail})`);
  }

  return lines.join("\n");
}
