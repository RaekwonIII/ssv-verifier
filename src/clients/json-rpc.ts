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
    throw new Error(`RPC request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as JsonRpcResponse<T>;

  if ("error" in payload) {
    throw new Error(`RPC ${method} failed: ${payload.error.message}`);
  }

  return payload.result;
}
