const metaQuery = `query { _meta { block { number } } }`;

interface SubgraphMetaResponse {
  data?: {
    _meta?: {
      block?: {
        number?: number;
      };
    };
  };
  errors?: Array<{ message: string }>;
}

export interface SubgraphMetaResult {
  indexedBlockNumber: number;
  source: "primary" | "fallback";
}

async function fetchSubgraphMetaOnce(
  url: string,
  source: "primary" | "fallback",
  fetchFn: typeof fetch,
): Promise<SubgraphMetaResult> {
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: metaQuery }),
  });

  if (!response.ok) {
    throw new Error(`Subgraph request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as SubgraphMetaResponse;

  if (payload.errors?.length) {
    throw new Error(`Subgraph query failed: ${payload.errors[0]?.message ?? "unknown error"}`);
  }

  const blockNumber = payload.data?._meta?.block?.number;

  if (typeof blockNumber !== "number") {
    throw new Error("Subgraph response did not include _meta.block.number");
  }

  return {
    indexedBlockNumber: blockNumber,
    source,
  };
}

export async function fetchSubgraphMeta(
  primaryUrl: string,
  fallbackUrl: string | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<SubgraphMetaResult> {
  try {
    return await fetchSubgraphMetaOnce(primaryUrl, "primary", fetchFn);
  } catch (primaryError) {
    if (!fallbackUrl) {
      throw primaryError;
    }

    return fetchSubgraphMetaOnce(fallbackUrl, "fallback", fetchFn);
  }
}
