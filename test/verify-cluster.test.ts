import { describe, expect, it } from "vitest";

import { verifyClusterIdentity, renderVerifyClusterSummary } from "../src/commands/verify-cluster.js";
import { loadRuntimeConfig } from "../src/config/env.js";
import { parseCliArgs } from "../src/index.js";

const baseEnv = {
  MAINNET_RPC_URL: "https://mainnet.example",
  HOODI_RPC_URL: "https://hoodi.example",
  MAINNET_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000001",
  HOODI_VIEWS_ADDRESS: "0x0000000000000000000000000000000000000002",
};

const clusterId = "0xe8c927a1fa792eddefe23fda643a62e03f999830-5-6-7-523";

describe("parseCliArgs verify-cluster", () => {
  it("parses the verify-cluster command", () => {
    expect(parseCliArgs(["verify-cluster", "--network", "hoodi", "--cluster", clusterId])).toEqual({
      command: "verify-cluster",
      network: "hoodi",
      clusterId,
    });
  });
});

describe("verifyClusterIdentity", () => {
  it("reports a successful comparison flow", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    let ethCallCount = 0;
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

      if (body.method === "eth_call") {
        ethCallCount += 1;

        if (ethCallCount === 1) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000000000000" }), { status: 200 });
        }

        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: IncorrectClusterState" } }),
          { status: 200 },
        );
      }

      if (body.query?.includes("cluster(id: $id)")) {
        return new Response(
          JSON.stringify({
            data: {
              cluster: {
                id: clusterId,
                owner: { id: "0xe8c927a1fa792eddefe23fda643a62e03f999830" },
                operatorIds: ["5", "6", "7", "523"],
                validatorCount: "1",
                networkFeeIndex: "10",
                index: "20",
                active: true,
                balance: "30",
              },
            },
          }),
          { status: 200 },
        );
      }

      throw new Error(`Unexpected request payload: ${JSON.stringify(body)}`);
    };

    const result = await verifyClusterIdentity(config, clusterId, { fetchFn });

    expect(result.status).toBe("pass");
    expect(result.checks).toHaveLength(4);
    expect(result.checks.every((check) => check.status === "pass")).toBe(true);
    expect(renderVerifyClusterSummary(result)).toContain("verify-cluster PASS");
  });

  it("reports when Views rejects the subgraph state", async () => {
    const config = loadRuntimeConfig("hoodi", baseEnv);
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method?: string; query?: string };

      if (body.method === "eth_call") {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: ClusterDoesNotExists" } }),
          { status: 200 },
        );
      }

      if (body.query?.includes("cluster(id: $id)")) {
        return new Response(
          JSON.stringify({
            data: {
              cluster: {
                id: clusterId,
                owner: { id: "0xe8c927a1fa792eddefe23fda643a62e03f999830" },
                operatorIds: ["5", "6", "7", "523"],
                validatorCount: "1",
                networkFeeIndex: "10",
                index: "20",
                active: true,
                balance: "30",
              },
            },
          }),
          { status: 200 },
        );
      }

      throw new Error(`Unexpected request payload: ${JSON.stringify(body)}`);
    };

    const result = await verifyClusterIdentity(config, clusterId, { fetchFn });

    expect(result.status).toBe("fail");
    expect(result.checks.every((check) => check.status === "fail")).toBe(true);
    expect(renderVerifyClusterSummary(result)).toContain("Views rejected the subgraph cluster state");
  });
});
