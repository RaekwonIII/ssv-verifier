import type { NetworkRuntimeConfig, RuntimeConfig } from "../config/env.js";
import { jsonRpcRequest, RpcHttpError, RpcMethodError } from "./json-rpc.js";

export interface RpcClient {
  call<T>(method: string, params: unknown[]): Promise<T>;
}

export interface RpcPoolOptions {
  urls: string[];
  maxInflightPerEndpoint: number;
  fetchFn?: typeof fetch;
}

interface EndpointState {
  url: string;
  index: number;
  inflight: number;
}

interface Slot {
  endpoint: EndpointState;
}

interface Waiter {
  exclude: ReadonlySet<number>;
  resolve(slot: Slot): void;
}

function isTransientError(error: unknown): boolean {
  if (error instanceof RpcMethodError) {
    return false;
  }

  if (error instanceof RpcHttpError) {
    return error.status === 429 || error.status >= 500;
  }

  // Network-level failures (fetch throws TypeError, AbortError, etc.) are transient.
  return true;
}

export function createRpcPool(options: RpcPoolOptions): RpcClient {
  if (options.urls.length === 0) {
    throw new Error("createRpcPool requires at least one URL");
  }

  if (options.maxInflightPerEndpoint <= 0) {
    throw new Error("maxInflightPerEndpoint must be positive");
  }

  const fetchFn = options.fetchFn ?? fetch;
  const cap = options.maxInflightPerEndpoint;
  const endpoints: EndpointState[] = options.urls.map((url, index) => ({ url, index, inflight: 0 }));
  const waiters: Waiter[] = [];
  let cursor = 0;

  function findAvailableEndpoint(exclude: ReadonlySet<number>): EndpointState | null {
    for (let attempt = 0; attempt < endpoints.length; attempt += 1) {
      const candidate = endpoints[(cursor + attempt) % endpoints.length]!;
      if (exclude.has(candidate.index)) {
        continue;
      }
      if (candidate.inflight < cap) {
        return candidate;
      }
    }
    return null;
  }

  function take(endpoint: EndpointState): Slot {
    endpoint.inflight += 1;
    cursor = (endpoint.index + 1) % endpoints.length;
    return { endpoint };
  }

  function acquire(exclude: ReadonlySet<number> = new Set()): Promise<Slot> {
    if (exclude.size >= endpoints.length) {
      return Promise.reject(new Error("No RPC endpoints available outside the excluded set"));
    }

    const available = findAvailableEndpoint(exclude);

    if (available) {
      return Promise.resolve(take(available));
    }

    return new Promise<Slot>((resolve) => {
      waiters.push({ exclude, resolve });
    });
  }

  function drainWaiters(): void {
    let i = 0;
    while (i < waiters.length) {
      const waiter = waiters[i]!;
      const candidate = findAvailableEndpoint(waiter.exclude);

      if (!candidate) {
        return;
      }

      waiters.splice(i, 1);
      waiter.resolve(take(candidate));
    }
  }

  function release(endpoint: EndpointState): void {
    endpoint.inflight -= 1;
    drainWaiters();
  }

  async function call<T>(method: string, params: unknown[]): Promise<T> {
    const firstSlot = await acquire();
    let firstError: unknown;

    try {
      return await jsonRpcRequest<T>(firstSlot.endpoint.url, method, params, fetchFn);
    } catch (error) {
      firstError = error;
    } finally {
      release(firstSlot.endpoint);
    }

    if (!isTransientError(firstError) || endpoints.length < 2) {
      throw firstError;
    }

    let secondSlot: Slot;
    try {
      secondSlot = await acquire(new Set([firstSlot.endpoint.index]));
    } catch {
      throw firstError;
    }

    try {
      return await jsonRpcRequest<T>(secondSlot.endpoint.url, method, params, fetchFn);
    } finally {
      release(secondSlot.endpoint);
    }
  }

  return { call };
}

export function createNetworkRpcPool(
  config: RuntimeConfig,
  networkConfig: NetworkRuntimeConfig,
  fetchFn: typeof fetch = fetch,
): RpcClient {
  return createRpcPool({
    urls: networkConfig.rpcUrls,
    maxInflightPerEndpoint: config.rpcMaxInflightPerEndpoint,
    fetchFn,
  });
}
