import { ZodError } from "zod";

import { loadRuntimeConfig } from "./config/env.js";
import { renderVerifyNetworkSummary, verifyNetworkHealth } from "./commands/verify-network.js";
import { isNetworkTarget, supportedNetworks, type NetworkTarget } from "./config/networks.js";

interface CliArgs {
  command: "bootstrap" | "verify-network";
  network: NetworkTarget;
}

export function parseCliArgs(argv: string[]): CliArgs {
  let command: CliArgs["command"] = "bootstrap";
  let network: NetworkTarget | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (index === 0 && arg === "verify-network") {
      command = "verify-network";
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

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!network) {
    throw new Error("Missing required --network option.");
  }

  return { command, network };
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
    "Usage: ssv-verifier [verify-network] --network <hoodi|mainnet|both>",
    "",
    "Commands:",
    "  verify-network  Run RPC, subgraph, and Views health checks",
    "",
    "Options:",
    "  -n, --network   Select which network scope to run",
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
      process.exitCode = results.every((result) => result.status === "pass") ? 0 : 1;
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
