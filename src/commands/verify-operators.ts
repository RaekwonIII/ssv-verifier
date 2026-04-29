import type { RuntimeConfig } from "../config/env.js";
import type { SingleNetwork } from "../config/networks.js";
import { fetchAllSubgraphOperatorDetails } from "../clients/subgraph.js";
import { createNetworkRpcPool } from "../clients/rpc-pool.js";
import { createViewsAdapter, type ViewsAdapter } from "../clients/views.js";
import { summarizeStatuses, type CheckStatus } from "../status.js";
import { compareOperatorAgainstViews, type VerifyOperatorResult } from "./verify-operator.js";

export interface VerifyOperatorsDependencies {
  fetchFn?: typeof fetch;
  fetchOperatorDetails?: typeof fetchAllSubgraphOperatorDetails;
  createViewsAdapter?: (rpcUrls: string[], viewsAddress: string, fetchFn: typeof fetch) => ViewsAdapter;
}

export interface VerifyOperatorBatchResult extends VerifyOperatorResult {
  errorDetail?: string;
}

export interface VerifyOperatorsResult {
  network: SingleNetwork;
  status: CheckStatus;
  subgraphSource: "primary" | "fallback";
  totalOperators: number;
  totalChecks: number;
  passedChecks: number;
  warnedChecks: number;
  inconclusiveChecks: number;
  failedChecks: number;
  operatorResults: VerifyOperatorBatchResult[];
}

export interface VerifyOperatorsRunResult {
  selectedNetwork: RuntimeConfig["selectedNetwork"];
  status: CheckStatus;
  totalOperators: number;
  totalChecks: number;
  passedChecks: number;
  warnedChecks: number;
  inconclusiveChecks: number;
  failedChecks: number;
  networkResults: VerifyOperatorsResult[];
}

async function verifyAllOperatorsForNetwork(
  config: RuntimeConfig,
  network: SingleNetwork,
  dependencies: VerifyOperatorsDependencies,
): Promise<VerifyOperatorsResult> {
  const fetchFn = dependencies.fetchFn ?? fetch;
  const fetchOperatorDetails = dependencies.fetchOperatorDetails ?? fetchAllSubgraphOperatorDetails;
  const networkConfig = config.networks[network];
  const createViews = dependencies.createViewsAdapter
    ?? ((urls, viewsAddress, innerFetchFn) => createViewsAdapter(
      createNetworkRpcPool(config, { ...networkConfig, rpcUrls: urls }, innerFetchFn),
      viewsAddress,
    ));
  const operatorListing = await fetchOperatorDetails(
    networkConfig.subgraphPrimaryUrl,
    networkConfig.subgraphFallbackUrl,
    fetchFn,
  );
  const viewsAdapter = createViews(networkConfig.rpcUrls, networkConfig.viewsAddress, fetchFn);
  const operatorResults = await Promise.all(
    operatorListing.operators.map(async (subgraphOperator) => {
      const operatorId = subgraphOperator.id;

      try {
        const viewsDetails = await viewsAdapter.getOperatorDetails(BigInt(operatorId));

        return compareOperatorAgainstViews(
          network,
          operatorId,
          subgraphOperator,
          viewsDetails,
          operatorListing.source,
        );
      } catch (error) {
        return {
          network,
          operatorId,
          subgraphSource: operatorListing.source,
          status: "inconclusive",
          checks: [
            {
              name: "operator",
              status: "inconclusive",
              detail: error instanceof Error ? error.message : String(error),
              subgraphValue: "unavailable",
              viewsValue: "unavailable",
            },
          ],
          errorDetail: error instanceof Error ? error.message : String(error),
        } satisfies VerifyOperatorBatchResult;
      }
    }),
  );
  const totalChecks = operatorResults.reduce((sum, result) => sum + result.checks.length, 0);
  const passedChecks = operatorResults.reduce(
    (sum, result) => sum + result.checks.filter((check) => check.status === "pass").length,
    0,
  );
  const warnedChecks = operatorResults.reduce(
    (sum, result) => sum + result.checks.filter((check) => check.status === "warn").length,
    0,
  );
  const inconclusiveChecks = operatorResults.reduce(
    (sum, result) => sum + result.checks.filter((check) => check.status === "inconclusive").length,
    0,
  );
  const failedChecks = operatorResults.reduce(
    (sum, result) => sum + result.checks.filter((check) => check.status === "fail").length,
    0,
  );

  return {
    network,
    status: summarizeStatuses(operatorResults.map((result) => result.status)),
    subgraphSource: operatorListing.source,
    totalOperators: operatorResults.length,
    totalChecks,
    passedChecks,
    warnedChecks,
    inconclusiveChecks,
    failedChecks,
    operatorResults,
  };
}

export async function verifyOperators(
  config: RuntimeConfig,
  dependencies: VerifyOperatorsDependencies = {},
): Promise<VerifyOperatorsRunResult> {
  const networkResults = await Promise.all(
    config.activeNetworks.map((network) => verifyAllOperatorsForNetwork(config, network, dependencies)),
  );
  const totalOperators = networkResults.reduce((sum, result) => sum + result.totalOperators, 0);
  const totalChecks = networkResults.reduce((sum, result) => sum + result.totalChecks, 0);
  const passedChecks = networkResults.reduce((sum, result) => sum + result.passedChecks, 0);
  const warnedChecks = networkResults.reduce((sum, result) => sum + result.warnedChecks, 0);
  const inconclusiveChecks = networkResults.reduce((sum, result) => sum + result.inconclusiveChecks, 0);
  const failedChecks = networkResults.reduce((sum, result) => sum + result.failedChecks, 0);

  return {
    selectedNetwork: config.selectedNetwork,
    status: summarizeStatuses(networkResults.map((result) => result.status)),
    totalOperators,
    totalChecks,
    passedChecks,
    warnedChecks,
    inconclusiveChecks,
    failedChecks,
    networkResults,
  };
}

export function renderVerifyOperatorsSummary(result: VerifyOperatorsRunResult): string {
  const lines = [
    `verify-operators ${result.status.toUpperCase()}`,
    `network selection: ${result.selectedNetwork}`,
    `operators: ${result.totalOperators}`,
    `checks: ${result.passedChecks} passed / ${result.warnedChecks} warned / ${result.inconclusiveChecks} inconclusive / ${result.failedChecks} failed / ${result.totalChecks} total`,
  ];

  for (const networkResult of result.networkResults) {
    lines.push(
      `- ${networkResult.network}: ${networkResult.passedChecks} passed / ${networkResult.warnedChecks} warned / ${networkResult.inconclusiveChecks} inconclusive / ${networkResult.failedChecks} failed / ${networkResult.totalChecks} total (source=${networkResult.subgraphSource})`,
    );

    for (const operatorResult of networkResult.operatorResults.filter((entry) => entry.status !== "pass")) {
      const nonPassingChecks = operatorResult.checks
        .filter((check) => check.status !== "pass")
        .map((check) => `${check.name}:${check.status}`);

      if (nonPassingChecks.length > 0) {
        lines.push(`- ${networkResult.network}/${operatorResult.operatorId}: non-passing checks=${nonPassingChecks.join(", ")}`);
        continue;
      }

      lines.push(`- ${networkResult.network}/${operatorResult.operatorId}: ${operatorResult.status.toUpperCase()} (${operatorResult.errorDetail ?? "operator verification failed"})`);
    }
  }

  return lines.join("\n");
}

export function renderVerifyOperatorsJson(result: VerifyOperatorsRunResult): string {
  return JSON.stringify(result, null, 2);
}
