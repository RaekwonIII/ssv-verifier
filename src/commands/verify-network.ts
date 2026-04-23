import type { RuntimeConfig } from "../config/env.js";
import { jsonRpcRequest } from "../clients/json-rpc.js";
import { fetchSubgraphMeta } from "../clients/subgraph.js";
import { summarizeStatuses, type CheckStatus } from "../status.js";

export interface HealthCheckResult {
  name: "rpc" | "subgraph" | "views";
  status: CheckStatus;
  detail: string;
}

export interface NetworkHealthResult {
  network: keyof RuntimeConfig["networks"];
  status: CheckStatus;
  checks: HealthCheckResult[];
}

export interface VerifyNetworkDependencies {
  fetchFn?: typeof fetch;
}

function formatFailureDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runRpcCheck(rpcUrl: string, fetchFn: typeof fetch): Promise<HealthCheckResult> {
  try {
    const blockHex = await jsonRpcRequest<string>(rpcUrl, "eth_blockNumber", [], fetchFn);
    const blockNumber = Number.parseInt(blockHex, 16);

    return {
      name: "rpc",
      status: "pass",
      detail: `reachable at block ${blockNumber}`,
    };
  } catch (error) {
    return {
      name: "rpc",
      status: "fail",
      detail: formatFailureDetail(error),
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

async function runViewsCheck(rpcUrl: string, viewsAddress: string, fetchFn: typeof fetch): Promise<HealthCheckResult> {
  try {
    const code = await jsonRpcRequest<string>(rpcUrl, "eth_getCode", [viewsAddress, "latest"], fetchFn);

    if (code === "0x") {
      throw new Error(`no contract bytecode at ${viewsAddress}`);
    }

    return {
      name: "views",
      status: "pass",
      detail: `contract code found at ${viewsAddress}`,
    };
  } catch (error) {
    return {
      name: "views",
      status: "fail",
      detail: formatFailureDetail(error),
    };
  }
}

export async function verifyNetworkHealth(
  config: RuntimeConfig,
  dependencies: VerifyNetworkDependencies = {},
): Promise<NetworkHealthResult[]> {
  const fetchFn = dependencies.fetchFn ?? fetch;

  const results: NetworkHealthResult[] = [];

  for (const network of config.activeNetworks) {
    const networkConfig = config.networks[network];
    const checks = [
      await runRpcCheck(networkConfig.rpcUrl, fetchFn),
      await runSubgraphCheck(networkConfig.subgraphPrimaryUrl, networkConfig.subgraphFallbackUrl, fetchFn),
      await runViewsCheck(networkConfig.rpcUrl, networkConfig.viewsAddress, fetchFn),
    ];

    results.push({
      network,
      status: summarizeStatuses(checks.map((check) => check.status)),
      checks,
    });
  }

  return results;
}

export function renderVerifyNetworkSummary(results: NetworkHealthResult[]): string {
  const overallStatus = summarizeStatuses(results.map((result) => result.status)).toUpperCase();
  const lines = [`verify-network ${overallStatus}`];

  for (const result of results) {
    lines.push(`${result.network}: ${result.status.toUpperCase()}`);

    for (const check of result.checks) {
      lines.push(`- ${check.name}: ${check.status.toUpperCase()} (${check.detail})`);
    }
  }

  return lines.join("\n");
}
