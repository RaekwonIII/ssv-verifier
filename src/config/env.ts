import { config as loadDotenv } from "dotenv";
import { z } from "zod";

import { getDaoAddress, getFallbackSubgraphUrl, getPrimarySubgraphUrl, resolveNetworks, type NetworkTarget } from "./networks.js";

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
  THEGRAPH_API_KEY: z.string().optional(),
  RPC_MAX_INFLIGHT_PER_ENDPOINT: rpcMaxInflightSchema,
});

export interface NetworkRuntimeConfig {
  rpcUrls: string[];
  viewsAddress: string;
  daoAddress: string;
  subgraphPrimaryUrl: string;
  subgraphFallbackUrl?: string;
}

export interface RuntimeConfig {
  selectedNetwork: NetworkTarget;
  networks: Record<"hoodi" | "mainnet", NetworkRuntimeConfig>;
  activeNetworks: ReturnType<typeof resolveNetworks>;
  rpcMaxInflightPerEndpoint: number;
  theGraphApiKey?: string;
}

export function loadRuntimeConfig(selectedNetwork: NetworkTarget, env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const parsedEnv = rawEnvSchema.parse(env);
  const theGraphApiKey = parsedEnv.THEGRAPH_API_KEY || undefined;
  const hoodiFallbackUrl = getFallbackSubgraphUrl("hoodi", theGraphApiKey);
  const mainnetFallbackUrl = getFallbackSubgraphUrl("mainnet", theGraphApiKey);

  return {
    selectedNetwork,
    networks: {
      hoodi: {
        rpcUrls: parsedEnv.HOODI_RPC_URL,
        viewsAddress: parsedEnv.HOODI_VIEWS_ADDRESS.toLowerCase(),
        daoAddress: getDaoAddress("hoodi"),
        subgraphPrimaryUrl: getPrimarySubgraphUrl("hoodi"),
        ...(hoodiFallbackUrl ? { subgraphFallbackUrl: hoodiFallbackUrl } : {}),
      },
      mainnet: {
        rpcUrls: parsedEnv.MAINNET_RPC_URL,
        viewsAddress: parsedEnv.MAINNET_VIEWS_ADDRESS.toLowerCase(),
        daoAddress: getDaoAddress("mainnet"),
        subgraphPrimaryUrl: getPrimarySubgraphUrl("mainnet"),
        ...(mainnetFallbackUrl ? { subgraphFallbackUrl: mainnetFallbackUrl } : {}),
      },
    },
    activeNetworks: resolveNetworks(selectedNetwork),
    rpcMaxInflightPerEndpoint: parsedEnv.RPC_MAX_INFLIGHT_PER_ENDPOINT,
    ...(theGraphApiKey ? { theGraphApiKey } : {}),
  };
}
