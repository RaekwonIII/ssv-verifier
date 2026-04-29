import type { RuntimeConfig } from "../config/env.js";
import type { NetworkTarget } from "../config/networks.js";
import type { ProgressReporter } from "../ui/progress.js";
import { jsonRpcRequest } from "../clients/json-rpc.js";
import { fetchSubgraphMeta } from "../clients/subgraph.js";
import { summarizeStatuses, type CheckStatus } from "../status.js";

export interface HealthCheckResult {
  name: "rpc" | "subgraph" | "views";
  status: CheckStatus;
  detail: string;
  endpoint?: string;
}

export interface NetworkHealthResult {
  network: keyof RuntimeConfig["networks"];
  status: CheckStatus;
  checks: HealthCheckResult[];
}

export interface HealthCheckRunResult {
  selectedNetwork: NetworkTarget;
  status: CheckStatus;
  networkResults: NetworkHealthResult[];
}

export interface HealthCheckDependencies {
  fetchFn?: typeof fetch;
}

function formatFailureDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function probeRpcEndpoint(rpcUrl: string, fetchFn: typeof fetch): Promise<HealthCheckResult> {
  try {
    const blockHex = await jsonRpcRequest<string>(rpcUrl, "eth_blockNumber", [], fetchFn);
    const blockNumber = Number.parseInt(blockHex, 16);

    return {
      name: "rpc",
      status: "pass",
      detail: `reachable at block ${blockNumber}`,
      endpoint: rpcUrl,
    };
  } catch (error) {
    return {
      name: "rpc",
      status: "fail",
      detail: formatFailureDetail(error),
      endpoint: rpcUrl,
    };
  }
}

async function probeViewsEndpoint(rpcUrl: string, viewsAddress: string, fetchFn: typeof fetch): Promise<HealthCheckResult> {
  try {
    const code = await jsonRpcRequest<string>(rpcUrl, "eth_getCode", [viewsAddress, "latest"], fetchFn);

    if (code === "0x") {
      throw new Error(`no contract bytecode at ${viewsAddress}`);
    }

    return {
      name: "views",
      status: "pass",
      detail: `contract code found at ${viewsAddress}`,
      endpoint: rpcUrl,
    };
  } catch (error) {
    return {
      name: "views",
      status: "fail",
      detail: formatFailureDetail(error),
      endpoint: rpcUrl,
    };
  }
}

async function runSubgraphCheck(
  primaryUrl: string,
  fallbackUrl: string | undefined,
  fetchFn: typeof fetch,
): Promise<HealthCheckResult> {
  try {
    const meta = await fetchSubgraphMeta(primaryUrl, fallbackUrl, fetchFn);

    return {
      name: "subgraph",
      status: "pass",
      detail: `${meta.source} endpoint reachable at indexed block ${meta.indexedBlockNumber}`,
    };
  } catch (error) {
    return {
      name: "subgraph",
      status: "fail",
      detail: formatFailureDetail(error),
    };
  }
}

export async function runHealthCheck(
  config: RuntimeConfig,
  dependencies: HealthCheckDependencies = {},
  reporter?: ProgressReporter,
): Promise<NetworkHealthResult[]> {
  const fetchFn = dependencies.fetchFn ?? fetch;

  const results: NetworkHealthResult[] = [];
  const totalProbes = config.activeNetworks.reduce(
    (sum, network) => sum + 2 * config.networks[network].rpcUrls.length + 1,
    0,
  );
  const bar = totalProbes > 0 ? reporter?.bar(totalProbes, "Health checks") : undefined;

  for (const network of config.activeNetworks) {
    const networkConfig = config.networks[network];
    const checks: HealthCheckResult[] = [];

    for (const rpcUrl of networkConfig.rpcUrls) {
      checks.push(await probeRpcEndpoint(rpcUrl, fetchFn));
      bar?.tick();
    }

    checks.push(await runSubgraphCheck(networkConfig.subgraphPrimaryUrl, networkConfig.subgraphFallbackUrl, fetchFn));
    bar?.tick();

    for (const rpcUrl of networkConfig.rpcUrls) {
      checks.push(await probeViewsEndpoint(rpcUrl, networkConfig.viewsAddress, fetchFn));
      bar?.tick();
    }

    results.push({
      network,
      status: summarizeStatuses(checks.map((check) => check.status)),
      checks,
    });
  }

  bar?.stop();
  return results;
}

export function renderHealthCheckSummary(results: NetworkHealthResult[]): string {
  const overallStatus = summarizeStatuses(results.map((result) => result.status)).toUpperCase();
  const lines = [`health-check ${overallStatus}`];

  for (const result of results) {
    lines.push(`${result.network}: ${result.status.toUpperCase()}`);

    for (const check of result.checks) {
      const endpoint = check.endpoint ? ` [${check.endpoint}]` : "";
      lines.push(`- ${check.name}${endpoint}: ${check.status.toUpperCase()} (${check.detail})`);
    }
  }

  return lines.join("\n");
}

export function renderHealthCheckJson(selectedNetwork: NetworkTarget, results: NetworkHealthResult[]): string {
  const payload: HealthCheckRunResult = {
    selectedNetwork,
    status: summarizeStatuses(results.map((result) => result.status)),
    networkResults: results,
  };

  return JSON.stringify(payload, null, 2);
}
