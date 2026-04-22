export const supportedNetworks = ["hoodi", "mainnet", "both"] as const;

export type NetworkTarget = (typeof supportedNetworks)[number];
export type SingleNetwork = Exclude<NetworkTarget, "both">;

export const networkOrder: SingleNetwork[] = ["hoodi", "mainnet"];

const primarySubgraphUrls = {
  hoodi: "https://api.studio.thegraph.com/query/71118/ssv-network-hoodi/version/latest",
  mainnet: "https://api.studio.thegraph.com/query/71118/ssv-network-ethereum/version/latest",
} as const;

const fallbackSubgraphIds = {
  hoodi: "F4AU5vPCuKfHvnLsusibxJEiTN7ELCoYTvnzg3YHGYbh",
  mainnet: "7V45fKPugp9psQjgrGsfif98gWzCyC6ChN7CW98VyQnr",
} as const;

const daoAddresses = {
  hoodi: "0x58410bef803ecd7e63b23664c586a6db72daf59c",
  mainnet: "0xdd9bc35ae942ef0cfa76930954a156b3ff30a4e1",
} as const;

export function isNetworkTarget(value: string): value is NetworkTarget {
  return (supportedNetworks as readonly string[]).includes(value);
}

export function resolveNetworks(target: NetworkTarget): SingleNetwork[] {
  return target === "both" ? [...networkOrder] : [target];
}

export function getPrimarySubgraphUrl(network: SingleNetwork): string {
  return primarySubgraphUrls[network];
}

export function getFallbackSubgraphUrl(network: SingleNetwork, apiKey: string | undefined): string | undefined {
  if (!apiKey) {
    return undefined;
  }

  return `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${fallbackSubgraphIds[network]}`;
}

export function getDaoAddress(network: SingleNetwork): string {
  return daoAddresses[network];
}
