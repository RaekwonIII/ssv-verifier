export interface JsonRpcSuccess<T> {
  jsonrpc: "2.0";
  id: number;
  result: T;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: number;
  error: {
    code: number;
    message: string;
  };
}

type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcFailure;

export class RpcHttpError extends Error {
  readonly status: number;

  constructor(status: number, message?: string) {
    super(message ?? `RPC request failed with status ${status}`);
    this.name = "RpcHttpError";
    this.status = status;
  }
}

export class RpcMethodError extends Error {
  readonly code: number;
  readonly method: string;

  constructor(method: string, code: number, message: string) {
    super(`RPC ${method} failed: ${message}`);
    this.name = "RpcMethodError";
    this.code = code;
    this.method = method;
  }
}

export async function jsonRpcRequest<T>(
  url: string,
  method: string,
  params: unknown[],
  fetchFn: typeof fetch = fetch,
): Promise<T> {
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new RpcHttpError(response.status);
  }

  const payload = (await response.json()) as JsonRpcResponse<T>;

  if ("error" in payload) {
    throw new RpcMethodError(method, payload.error.code, payload.error.message);
  }

  return payload.result;
}
