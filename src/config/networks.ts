export const supportedNetworks = ["hoodi", "mainnet", "both"] as const;

export type NetworkTarget = (typeof supportedNetworks)[number];
export type SingleNetwork = Exclude<NetworkTarget, "both">;

export const networkOrder: SingleNetwork[] = ["hoodi", "mainnet"];

export function isNetworkTarget(value: string): value is NetworkTarget {
  return (supportedNetworks as readonly string[]).includes(value);
}

export function resolveNetworks(target: NetworkTarget): SingleNetwork[] {
  return target === "both" ? [...networkOrder] : [target];
}
