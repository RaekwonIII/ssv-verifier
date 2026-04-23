import { ZodError } from "zod";

import { loadRuntimeConfig } from "./config/env.js";
import { renderVerifyClusterJson, renderVerifyClusterSummary, verifyClusterIdentity } from "./commands/verify-cluster.js";
import { renderVerifyConfigSummary, verifyNetworkConfig } from "./commands/verify-config.js";
import { renderVerifyClustersSummary, verifyClusters } from "./commands/verify-clusters.js";
import { renderVerifyOperatorSummary, verifyOperatorState } from "./commands/verify-operator.js";
import { renderVerifyNetworkSummary, verifyNetworkHealth } from "./commands/verify-network.js";
import { isNetworkTarget, supportedNetworks, type NetworkTarget } from "./config/networks.js";
import { exitCodeForStatus, summarizeStatuses } from "./status.js";

interface CliArgs {
  command: "bootstrap" | "verify-network" | "verify-cluster" | "verify-clusters" | "verify-operator" | "verify-config";
  network: NetworkTarget;
  clusterId?: string;
  operatorId?: string;
  output: "text" | "json";
}

export function parseCliArgs(argv: string[]): CliArgs {
  let command: CliArgs["command"] = "bootstrap";
  let network: NetworkTarget | undefined;
  let clusterId: string | undefined;
  let operatorId: string | undefined;
  let output: CliArgs["output"] = "text";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (index === 0 && (arg === "verify-network" || arg === "verify-cluster" || arg === "verify-clusters" || arg === "verify-operator" || arg === "verify-config")) {
      command = "verify-network";
      if (arg === "verify-cluster") {
        command = "verify-cluster";
      } else if (arg === "verify-clusters") {
        command = "verify-clusters";
      } else if (arg === "verify-operator") {
        command = "verify-operator";
      } else if (arg === "verify-config") {
        command = "verify-config";
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
    "Usage: ssv-verifier [verify-network|verify-cluster|verify-clusters] --network <hoodi|mainnet|both> [--cluster <id>] [--output <text|json>]",
    "",
    "Commands:",
    "  verify-network  Run RPC, subgraph, and Views health checks",
    "  verify-cluster  Verify one cluster identity against Views",
    "  verify-clusters Verify all clusters on one network",
    "  verify-operator Verify one operator against Views",
    "  verify-config   Verify DAO and network config against Views",
    "",
    "Options:",
    "  -n, --network   Select which network scope to run",
    "  -c, --cluster   Cluster identifier for verify-cluster",
    "      --operator  Operator identifier for verify-operator",
    "  -o, --output    Output format for verify-cluster (text or json)",
    "  -h, --help      Show this help text",
  ].join("\n");

  console.log(usage);
}

async function main(): Promise<void> {
  try {
    const args = parseCliArgs(process.argv.slice(2));
    if (args.command === "verify-network") {
      const results = await verifyNetworkHealth(loadRuntimeConfig(args.network));
      console.log(renderVerifyNetworkSummary(results));
      process.exitCode = exitCodeForStatus(summarizeStatuses(results.map((result) => result.status)));
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
      console.log(renderVerifyClustersSummary(result));
      process.exitCode = exitCodeForStatus(result.status);
      return;
    }

    if (args.command === "verify-operator") {
      const result = await verifyOperatorState(loadRuntimeConfig(args.network), args.operatorId ?? "");
      console.log(renderVerifyOperatorSummary(result));
      process.exitCode = exitCodeForStatus(result.status);
      return;
    }

    if (args.command === "verify-config") {
      const result = await verifyNetworkConfig(loadRuntimeConfig(args.network));
      console.log(renderVerifyConfigSummary(result));
      process.exitCode = exitCodeForStatus(result.status);
      return;
    }

    console.log(renderBootstrapSummary(args));
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
