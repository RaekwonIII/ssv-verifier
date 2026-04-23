import type { RuntimeConfig } from "../config/env.js";
import type { SingleNetwork } from "../config/networks.js";
import { fetchSubgraphOperator } from "../clients/subgraph.js";
import { getOperatorDetailsFromViews, getOperatorFeeFromViews } from "../clients/views.js";
import { summarizeStatuses, type CheckStatus } from "../status.js";

export interface OperatorCheckResult {
  name: "fee" | "validatorCount" | "active";
  status: CheckStatus;
  detail: string;
  subgraphValue: string;
  viewsValue: string;
}

export interface VerifyOperatorResult {
  network: SingleNetwork;
  operatorId: string;
  subgraphSource: "primary" | "fallback";
  status: CheckStatus;
  checks: OperatorCheckResult[];
}

export interface VerifyOperatorDependencies {
  fetchFn?: typeof fetch;
}

function summarizeStatus(checks: OperatorCheckResult[]): CheckStatus {
  return summarizeStatuses(checks.map((check) => check.status));
}

export async function verifyOperatorState(
  config: RuntimeConfig,
  operatorId: string,
  dependencies: VerifyOperatorDependencies = {},
): Promise<VerifyOperatorResult> {
  if (config.activeNetworks.length !== 1) {
    throw new Error("verify-operator requires a single network target, not --network both.");
  }

  const fetchFn = dependencies.fetchFn ?? fetch;
  const network = config.activeNetworks[0]!;
  const networkConfig = config.networks[network];
  const subgraphOperator = await fetchSubgraphOperator(
    networkConfig.subgraphPrimaryUrl,
    networkConfig.subgraphFallbackUrl,
    operatorId,
    fetchFn,
  );
  const viewsOperatorId = BigInt(operatorId);
  const [viewsFee, viewsDetails] = await Promise.all([
    getOperatorFeeFromViews(networkConfig.rpcUrl, networkConfig.viewsAddress, viewsOperatorId, fetchFn),
    getOperatorDetailsFromViews(networkConfig.rpcUrl, networkConfig.viewsAddress, viewsOperatorId, fetchFn),
  ]);
  const checks: OperatorCheckResult[] = [
    {
      name: "fee",
      status: BigInt(subgraphOperator.operator.fee) === viewsFee ? "pass" : "fail",
      detail: BigInt(subgraphOperator.operator.fee) === viewsFee ? "Operator fee matched Views" : "Operator fee did not match Views",
      subgraphValue: subgraphOperator.operator.fee,
      viewsValue: viewsFee.toString(),
    },
    {
      name: "validatorCount",
      status: Number.parseInt(subgraphOperator.operator.validatorCount, 10) === viewsDetails.validatorCount ? "pass" : "fail",
      detail: Number.parseInt(subgraphOperator.operator.validatorCount, 10) === viewsDetails.validatorCount
        ? "Operator validator count matched Views"
        : "Operator validator count did not match Views",
      subgraphValue: subgraphOperator.operator.validatorCount,
      viewsValue: String(viewsDetails.validatorCount),
    },
    {
      name: "active",
      status: subgraphOperator.operator.active === viewsDetails.active ? "pass" : "fail",
      detail: subgraphOperator.operator.active === viewsDetails.active
        ? "Operator active flag matched Views"
        : "Operator active flag did not match Views",
      subgraphValue: String(subgraphOperator.operator.active),
      viewsValue: String(viewsDetails.active),
    },
  ];

  return {
    network,
    operatorId,
    subgraphSource: subgraphOperator.source,
    status: summarizeStatus(checks),
    checks,
  };
}

export function renderVerifyOperatorSummary(result: VerifyOperatorResult): string {
  const lines = [
    `verify-operator ${result.status.toUpperCase()}`,
    `network: ${result.network}`,
    `operator: ${result.operatorId}`,
    `subgraph source: ${result.subgraphSource}`,
  ];

  for (const check of result.checks) {
    lines.push(`- ${check.name}: ${check.status.toUpperCase()} (subgraph=${check.subgraphValue}; views=${check.viewsValue}; ${check.detail})`);
  }

  return lines.join("\n");
}

export function renderVerifyOperatorJson(result: VerifyOperatorResult): string {
  return JSON.stringify(result, null, 2);
}
