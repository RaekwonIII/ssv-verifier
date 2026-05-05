import { config as loadDotenv } from "dotenv";
import { z } from "zod";

import { getDaoAddress, resolveNetworks, type NetworkTarget } from "./networks.js";

loadDotenv();

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "must be a 20-byte hex address");

const rpcUrlsSchema = z
  .string()
  .transform((value, ctx) => {
    const urls = value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    if (urls.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must contain at least one URL" });
      return z.NEVER;
    }

    for (const url of urls) {
      const parsed = z.string().url().safeParse(url);
      if (!parsed.success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `entry ${JSON.stringify(url)} is not a valid URL` });
        return z.NEVER;
      }
    }

    return urls;
  });

const rpcMaxInflightSchema = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === "") {
      return 10;
    }

    const parsed = Number.parseInt(value, 10);

    if (!Number.isFinite(parsed) || String(parsed) !== value.trim() || parsed <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be a positive integer" });
      return z.NEVER;
    }

    return parsed;
  });

const rawEnvSchema = z.object({
  MAINNET_RPC_URL: rpcUrlsSchema,
  HOODI_RPC_URL: rpcUrlsSchema,
  MAINNET_VIEWS_ADDRESS: addressSchema,
  HOODI_VIEWS_ADDRESS: addressSchema,
  MAINNET_SUBGRAPH_URL: z.string().url(),
  HOODI_SUBGRAPH_URL: z.string().url(),
  RPC_MAX_INFLIGHT_PER_ENDPOINT: rpcMaxInflightSchema,
});

export interface NetworkRuntimeConfig {
  rpcUrls: string[];
  viewsAddress: string;
  daoAddress: string;
  subgraphUrl: string;
}

export interface RuntimeConfig {
  selectedNetwork: NetworkTarget;
  networks: Record<"hoodi" | "mainnet", NetworkRuntimeConfig>;
  activeNetworks: ReturnType<typeof resolveNetworks>;
  rpcMaxInflightPerEndpoint: number;
}

export function loadRuntimeConfig(selectedNetwork: NetworkTarget, env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const parsedEnv = rawEnvSchema.parse(env);

  return {
    selectedNetwork,
    networks: {
      hoodi: {
        rpcUrls: parsedEnv.HOODI_RPC_URL,
        viewsAddress: parsedEnv.HOODI_VIEWS_ADDRESS.toLowerCase(),
        daoAddress: getDaoAddress("hoodi"),
        subgraphUrl: parsedEnv.HOODI_SUBGRAPH_URL,
      },
      mainnet: {
        rpcUrls: parsedEnv.MAINNET_RPC_URL,
        viewsAddress: parsedEnv.MAINNET_VIEWS_ADDRESS.toLowerCase(),
        daoAddress: getDaoAddress("mainnet"),
        subgraphUrl: parsedEnv.MAINNET_SUBGRAPH_URL,
      },
    },
    activeNetworks: resolveNetworks(selectedNetwork),
    rpcMaxInflightPerEndpoint: parsedEnv.RPC_MAX_INFLIGHT_PER_ENDPOINT,
  };
}
