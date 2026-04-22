import { describe, expect, it } from "vitest";

import { loadRuntimeConfig } from "../src/config/env.js";
import { parseCliArgs } from "../src/index.js";

const baseEnv = {
  MAINNET_RPC_URL: "https://mainnet.example",
  HOODI_RPC_URL: "https://hoodi.example",
  MAINNET_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000001",
  HOODI_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000002",
};

describe("parseCliArgs", () => {
  it("accepts both as a valid network target", () => {
    expect(parseCliArgs(["--network", "both"])).toEqual({ network: "both" });
  });

  it("rejects unsupported network values", () => {
    expect(() => parseCliArgs(["--network", "local"])).toThrow(/Invalid --network value/);
  });
});

describe("loadRuntimeConfig", () => {
  it("expands both into hoodi and mainnet", () => {
    const config = loadRuntimeConfig("both", baseEnv);

    expect(config.activeNetworks).toEqual(["hoodi", "mainnet"]);
    expect(config.networks.hoodi.viewsAddress).toBe("0x0000000000000000000000000000000000000002");
    expect(config.networks.mainnet.viewsAddress).toBe("0x0000000000000000000000000000000000000001");
  });
});
