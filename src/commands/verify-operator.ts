import type { RuntimeConfig } from "../config/env.js";
import type { SingleNetwork } from "../config/networks.js";
import { fetchSubgraphOperator } from "../clients/subgraph.js";
import { createViewsAdapter } from "../clients/views.js";
import { summarizeStatuses, type CheckStatus } from "../status.js";

export interface OperatorCheckResult {
  name: "feeETH" | "feeSSV" | "validatorCount" | "active";
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

function createComparableCheck(
  name: OperatorCheckResult["name"],
  subgraphValue: string | null,
  viewsValue: string,
  label: string,
): OperatorCheckResult {
  if (subgraphValue === null) {
    return {
      name,
      status: "inconclusive",
      detail: `Subgraph did not expose ${label}`,
      subgraphValue: "missing",
      viewsValue,
    };
  }

  const status: CheckStatus = subgraphValue === viewsValue ? "pass" : "fail";

  return {
    name,
    status,
    detail: status === "pass" ? `${label} matched Views` : `${label} did not match Views`,
    subgraphValue,
    viewsValue,
  };
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
  const viewsAdapter = createViewsAdapter(networkConfig.rpcUrl, networkConfig.viewsAddress, fetchFn);
  const [viewsEthFee, viewsSsvFee, viewsDetails] = await Promise.all([
    viewsAdapter.getOperatorFee("ETH", viewsOperatorId),
    viewsAdapter.getOperatorFee("SSV", viewsOperatorId),
    viewsAdapter.getOperatorDetails(viewsOperatorId),
  ]);
  const activeSubgraphValue = subgraphOperator.operator.removed === null
    ? null
    : String(!subgraphOperator.operator.removed);
  const checks: OperatorCheckResult[] = [
    createComparableCheck("feeETH", subgraphOperator.operator.fee, viewsEthFee.toString(), "Operator ETH fee"),
    createComparableCheck("feeSSV", subgraphOperator.operator.feeSSV, viewsSsvFee.toString(), "Operator SSV fee"),
    createComparableCheck("validatorCount", subgraphOperator.operator.validatorCount, String(viewsDetails.validatorCount), "Operator validator count"),
    createComparableCheck("active", activeSubgraphValue, String(viewsDetails.active), "Operator active flag"),
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
