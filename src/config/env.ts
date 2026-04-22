import { config as loadDotenv } from "dotenv";
import { z } from "zod";

import { getFallbackSubgraphUrl, getPrimarySubgraphUrl, resolveNetworks, type NetworkTarget } from "./networks.js";

loadDotenv();

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "must be a 20-byte hex address");

const rawEnvSchema = z.object({
  MAINNET_RPC_URL: z.string().url(),
  HOODI_RPC_URL: z.string().url(),
  MAINNET_VIEWS_ADDRESS: addressSchema,
  HOODI_VIEWS_ADDRESS: addressSchema,
  THEGRAPH_API_KEY: z.string().optional(),
});

export interface NetworkRuntimeConfig {
  rpcUrl: string;
  viewsAddress: string;
  subgraphPrimaryUrl: string;
  subgraphFallbackUrl?: string;
}

export interface RuntimeConfig {
  selectedNetwork: NetworkTarget;
  networks: Record<"hoodi" | "mainnet", NetworkRuntimeConfig>;
  activeNetworks: ReturnType<typeof resolveNetworks>;
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
        rpcUrl: parsedEnv.HOODI_RPC_URL,
        viewsAddress: parsedEnv.HOODI_VIEWS_ADDRESS.toLowerCase(),
        subgraphPrimaryUrl: getPrimarySubgraphUrl("hoodi"),
        ...(hoodiFallbackUrl ? { subgraphFallbackUrl: hoodiFallbackUrl } : {}),
      },
      mainnet: {
        rpcUrl: parsedEnv.MAINNET_RPC_URL,
        viewsAddress: parsedEnv.MAINNET_VIEWS_ADDRESS.toLowerCase(),
        subgraphPrimaryUrl: getPrimarySubgraphUrl("mainnet"),
        ...(mainnetFallbackUrl ? { subgraphFallbackUrl: mainnetFallbackUrl } : {}),
      },
    },
    activeNetworks: resolveNetworks(selectedNetwork),
    ...(theGraphApiKey ? { theGraphApiKey } : {}),
  };
}
