import { describe, expect, it } from "vitest";

import { createRpcPool } from "../src/clients/rpc-pool.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonRpcOk(id: number, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { status: 200 });
}

function jsonRpcErr(id: number, message: string, code = -32000): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), { status: 200 });
}

describe("createRpcPool", () => {
  it("round-robins requests across endpoints in order", async () => {
    const calledUrls: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
      calledUrls.push(String(input));
      return jsonRpcOk(1, "0x1");
    };

    const pool = createRpcPool({
      urls: ["https://a.example", "https://b.example", "https://c.example"],
      maxInflightPerEndpoint: 5,
      fetchFn,
    });

    await pool.call("eth_blockNumber", []);
    await pool.call("eth_blockNumber", []);
    await pool.call("eth_blockNumber", []);
    await pool.call("eth_blockNumber", []);

    expect(calledUrls).toEqual([
      "https://a.example",
      "https://b.example",
      "https://c.example",
      "https://a.example",
    ]);
  });

  it("respects per-endpoint in-flight cap and queues callers", async () => {
    const inflightPerUrl = new Map<string, number>();
    const peakInflight = new Map<string, number>();
    const completionGate = deferred<void>();
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      const current = (inflightPerUrl.get(url) ?? 0) + 1;
      inflightPerUrl.set(url, current);
      peakInflight.set(url, Math.max(peakInflight.get(url) ?? 0, current));
      await completionGate.promise;
      inflightPerUrl.set(url, (inflightPerUrl.get(url) ?? 1) - 1);
      return jsonRpcOk(1, "0x1");
    };

    const pool = createRpcPool({
      urls: ["https://only.example"],
      maxInflightPerEndpoint: 2,
      fetchFn,
    });

    const calls = [
      pool.call("eth_blockNumber", []),
      pool.call("eth_blockNumber", []),
      pool.call("eth_blockNumber", []),
      pool.call("eth_blockNumber", []),
    ];

    // Allow microtasks to run; only the first 2 should have started.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(inflightPerUrl.get("https://only.example")).toBe(2);

    completionGate.resolve();
    await Promise.all(calls);

    expect(peakInflight.get("https://only.example")).toBe(2);
  });

  it("skips a saturated endpoint and serves the next one with capacity", async () => {
    const order: string[] = [];
    const releases: Array<() => void> = [];
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      order.push(url);
      const release = deferred<void>();
      releases.push(() => release.resolve());
      await release.promise;
      return jsonRpcOk(1, "0x1");
    };

    const pool = createRpcPool({
      urls: ["https://a.example", "https://b.example"],
      maxInflightPerEndpoint: 1,
      fetchFn,
    });

    const first = pool.call("x", []);
    await new Promise((r) => setTimeout(r, 0));
    // First call took a.example. Second call should skip-ahead to b.example because a is saturated.
    const second = pool.call("x", []);
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(["https://a.example", "https://b.example"]);

    // Now release both.
    releases[0]!();
    releases[1]!();
    await Promise.all([first, second]);
  });

  it("retries once on a different endpoint after a transient HTTP 503", async () => {
    const calledUrls: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      calledUrls.push(url);
      if (url === "https://a.example") {
        return new Response("", { status: 503 });
      }
      return jsonRpcOk(1, "0x42");
    };

    const pool = createRpcPool({
      urls: ["https://a.example", "https://b.example"],
      maxInflightPerEndpoint: 5,
      fetchFn,
    });

    await expect(pool.call<string>("eth_blockNumber", [])).resolves.toBe("0x42");
    expect(calledUrls).toEqual(["https://a.example", "https://b.example"]);
  });

  it("retries once on network error (fetch throw)", async () => {
    const calledUrls: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      calledUrls.push(url);
      if (url === "https://a.example") {
        throw new TypeError("network unreachable");
      }
      return jsonRpcOk(1, "0xab");
    };

    const pool = createRpcPool({
      urls: ["https://a.example", "https://b.example"],
      maxInflightPerEndpoint: 5,
      fetchFn,
    });

    await expect(pool.call<string>("eth_call", [])).resolves.toBe("0xab");
    expect(calledUrls).toEqual(["https://a.example", "https://b.example"]);
  });

  it("does not retry RPC method errors", async () => {
    const calledUrls: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
      calledUrls.push(String(input));
      return jsonRpcErr(1, "execution reverted", 3);
    };

    const pool = createRpcPool({
      urls: ["https://a.example", "https://b.example"],
      maxInflightPerEndpoint: 5,
      fetchFn,
    });

    await expect(pool.call("eth_call", [])).rejects.toThrow(/RPC eth_call failed: execution reverted/);
    expect(calledUrls).toEqual(["https://a.example"]);
  });

  it("does not retry when only one endpoint is configured", async () => {
    const calledUrls: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
      calledUrls.push(String(input));
      return new Response("", { status: 503 });
    };

    const pool = createRpcPool({
      urls: ["https://only.example"],
      maxInflightPerEndpoint: 5,
      fetchFn,
    });

    await expect(pool.call("eth_call", [])).rejects.toThrow(/RPC request failed with status 503/);
    expect(calledUrls).toEqual(["https://only.example"]);
  });

  it("propagates the second-attempt error if the retry also fails", async () => {
    const calledUrls: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      calledUrls.push(url);
      if (url === "https://a.example") {
        return new Response("", { status: 503 });
      }
      return new Response("", { status: 502 });
    };

    const pool = createRpcPool({
      urls: ["https://a.example", "https://b.example"],
      maxInflightPerEndpoint: 5,
      fetchFn,
    });

    await expect(pool.call("eth_call", [])).rejects.toThrow(/RPC request failed with status 502/);
    expect(calledUrls).toEqual(["https://a.example", "https://b.example"]);
  });
});
