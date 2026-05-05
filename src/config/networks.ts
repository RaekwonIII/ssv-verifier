export const supportedNetworks = ["hoodi", "mainnet", "both"] as const;

export type NetworkTarget = (typeof supportedNetworks)[number];
export type SingleNetwork = Exclude<NetworkTarget, "both">;

export const networkOrder: SingleNetwork[] = ["hoodi", "mainnet"];

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

export function getDaoAddress(network: SingleNetwork): string {
  return daoAddresses[network];
}
