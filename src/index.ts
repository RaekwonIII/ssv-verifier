import { ZodError } from "zod";

import { loadRuntimeConfig } from "./config/env.js";
import { renderVerifyClusterJson, renderVerifyClusterSummary, verifyClusterIdentity } from "./commands/verify-cluster.js";
import { renderVerifyClustersJson, renderVerifyClustersSummary, verifyClusters } from "./commands/verify-clusters.js";
import { renderHealthCheckJson, renderHealthCheckSummary, runHealthCheck } from "./commands/health-check.js";
import { renderVerifyOperatorJson, renderVerifyOperatorSummary, verifyOperatorState } from "./commands/verify-operator.js";
import { renderVerifyOperatorsJson, renderVerifyOperatorsSummary, verifyOperators } from "./commands/verify-operators.js";
import { renderVerifyNetworkJson, renderVerifyNetworkSummary, verifyNetworkConfig } from "./commands/verify-network.js";
import { isNetworkTarget, supportedNetworks, type NetworkTarget } from "./config/networks.js";
import { exitCodeForStatus, summarizeStatuses } from "./status.js";

interface CliArgs {
  command: "health-check" | "verify-network" | "verify-cluster" | "verify-clusters" | "verify-operator" | "verify-operators";
  network: NetworkTarget;
  clusterId?: string;
  operatorId?: string;
  output: "text" | "json";
}

export function parseCliArgs(argv: string[]): CliArgs {
  let command: CliArgs["command"] = "health-check";
  let network: NetworkTarget | undefined;
  let clusterId: string | undefined;
  let operatorId: string | undefined;
  let output: CliArgs["output"] = "text";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (
      index === 0 &&
      (arg === "health-check" ||
        arg === "verify-network" ||
        arg === "verify-cluster" ||
        arg === "verify-clusters" ||
        arg === "verify-operator" ||
        arg === "verify-operators")
    ) {
      if (arg === "health-check" || arg === "verify-network") {
        command = arg;
      } else if (arg === "verify-cluster") {
        command = "verify-cluster";
      } else if (arg === "verify-clusters") {
        command = "verify-clusters";
      } else if (arg === "verify-operator") {
        command = "verify-operator";
      } else if (arg === "verify-operators") {
        command = "verify-operators";
      }
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--network" || arg === "-n") {
      const value = argv[index + 1];

      if (!value || !isNetworkTarget(value)) {
        throw new Error(`Invalid --network value. Expected one of: ${supportedNetworks.join(", ")}.`);
      }

      network = value;
      index += 1;
      continue;
    }

    if (arg === "--cluster" || arg === "-c") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error("Missing required --cluster value.");
      }

      clusterId = value;
      index += 1;
      continue;
    }

    if (arg === "--operator") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error("Missing required --operator value.");
      }

      operatorId = value;
      index += 1;
      continue;
    }

    if (arg === "--output" || arg === "-o") {
      const value = argv[index + 1];

      if (value !== "text" && value !== "json") {
        throw new Error("Invalid --output value. Expected one of: text, json.");
      }

      output = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!network) {
    throw new Error("Missing required --network option.");
  }

  if (command === "verify-cluster" && !clusterId) {
    throw new Error("Missing required --cluster option.");
  }

  if (command === "verify-operator" && !operatorId) {
    throw new Error("Missing required --operator option.");
  }

  return {
    command,
    network,
    output,
    ...(clusterId ? { clusterId } : {}),
    ...(operatorId ? { operatorId } : {}),
  };
}

export function renderBootstrapSummary(args: CliArgs): string {
  const config = loadRuntimeConfig(args.network);
  const lines = [
    "SSV verifier bootstrap is configured.",
    `Selected network target: ${config.selectedNetwork}`,
    `Active networks: ${config.activeNetworks.join(", ")}`,
  ];

  for (const network of config.activeNetworks) {
    const entry = config.networks[network];
    lines.push(`- ${network}: rpc=${entry.rpcUrl} views=${entry.viewsAddress}`);
  }

  return lines.join("\n");
}

export function printHelp(): void {
  const usage = [
    "Usage: ssv-verifier [health-check|verify-network|verify-cluster|verify-clusters|verify-operator|verify-operators] --network <hoodi|mainnet|both> [--cluster <id>] [--operator <id>] [--output <text|json>]",
    "",
    "Commands:",
    "  health-check     Run RPC, subgraph, and Views health checks",
    "  verify-network   Verify DAO and network config against Views",
    "  verify-cluster   Verify one cluster identity against Views",
    "  verify-clusters  Verify all clusters on one network",
    "  verify-operator  Verify one operator against Views",
    "  verify-operators Verify all operators on one or both networks",
    "",
    "Options:",
    "  -n, --network   Select which network scope to run",
    "  -c, --cluster   Cluster identifier for verify-cluster",
    "      --operator  Operator identifier for verify-operator",
    "  -o, --output    Output format for commands that support text or json",
    "  -h, --help      Show this help text",
  ].join("\n");

  console.log(usage);
}

async function main(): Promise<void> {
  try {
    const args = parseCliArgs(process.argv.slice(2));
    if (args.command === "health-check") {
      const results = await runHealthCheck(loadRuntimeConfig(args.network));
      console.log(args.output === "json" ? renderHealthCheckJson(args.network, results) : renderHealthCheckSummary(results));
      process.exitCode = exitCodeForStatus(summarizeStatuses(results.map((result) => result.status)));
      return;
    }

    if (args.command === "verify-network") {
      const result = await verifyNetworkConfig(loadRuntimeConfig(args.network));
      console.log(args.output === "json" ? renderVerifyNetworkJson(result) : renderVerifyNetworkSummary(result));
      process.exitCode = exitCodeForStatus(result.status);
      return;
    }

    if (args.command === "verify-cluster") {
      const result = await verifyClusterIdentity(loadRuntimeConfig(args.network), args.clusterId ?? "");
      console.log(args.output === "json" ? renderVerifyClusterJson(result) : renderVerifyClusterSummary(result));
      process.exitCode = exitCodeForStatus(result.status);
      return;
    }

    if (args.command === "verify-clusters") {
      const result = await verifyClusters(loadRuntimeConfig(args.network));
      console.log(args.output === "json" ? renderVerifyClustersJson(result) : renderVerifyClustersSummary(result));
      process.exitCode = exitCodeForStatus(result.status);
      return;
    }

    if (args.command === "verify-operator") {
      const result = await verifyOperatorState(loadRuntimeConfig(args.network), args.operatorId ?? "");
      console.log(args.output === "json" ? renderVerifyOperatorJson(result) : renderVerifyOperatorSummary(result));
      process.exitCode = exitCodeForStatus(result.status);
      return;
    }

    if (args.command === "verify-operators") {
      const result = await verifyOperators(loadRuntimeConfig(args.network));
      console.log(args.output === "json" ? renderVerifyOperatorsJson(result) : renderVerifyOperatorsSummary(result));
      process.exitCode = exitCodeForStatus(result.status);
      return;
    }
  } catch (error) {
    if (error instanceof ZodError) {
      console.error("Invalid runtime configuration:");
      for (const issue of error.issues) {
        console.error(`- ${issue.path.join(".")}: ${issue.message}`);
      }
      process.exitCode = 1;
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    printHelp();
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
