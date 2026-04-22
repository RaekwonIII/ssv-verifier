const metaQuery = `query { _meta { block { number } } }`;

const singleClusterQuery = `query ($id: ID!) {
  cluster(id: $id) {
    id
    owner { id }
    operatorIds
    validatorCount
    networkFeeIndex
    index
    active
    balance
  }
}`;

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

interface GraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export interface SubgraphMetaResult {
  indexedBlockNumber: number;
  source: "primary" | "fallback";
}

export interface SubgraphClusterRecord {
  id: string;
  owner: {
    id: string;
  };
  operatorIds: string[];
  validatorCount: string;
  networkFeeIndex: string;
  index: string;
  active: boolean;
  balance: string;
}

export interface SubgraphClusterResult {
  cluster: SubgraphClusterRecord;
  source: "primary" | "fallback";
}

async function postGraphql<T>(url: string, query: string, variables: Record<string, unknown>, fetchFn: typeof fetch): Promise<T> {
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Subgraph request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as GraphqlResponse<T>;

  if (payload.errors?.length) {
    throw new Error(`Subgraph query failed: ${payload.errors[0]?.message ?? "unknown error"}`);
  }

  if (!payload.data) {
    throw new Error("Subgraph response did not include data");
  }

  return payload.data;
}

async function fetchSubgraphMetaOnce(
  url: string,
  source: "primary" | "fallback",
  fetchFn: typeof fetch,
): Promise<SubgraphMetaResult> {
  const payload = await postGraphql<SubgraphMetaResponse["data"]>(url, metaQuery, {}, fetchFn);
  const blockNumber = payload?._meta?.block?.number;

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

async function fetchSubgraphClusterOnce(
  url: string,
  clusterId: string,
  source: "primary" | "fallback",
  fetchFn: typeof fetch,
): Promise<SubgraphClusterResult> {
  const payload = await postGraphql<{ cluster: SubgraphClusterRecord | null }>(
    url,
    singleClusterQuery,
    { id: clusterId },
    fetchFn,
  );

  if (!payload.cluster) {
    throw new Error(`Cluster ${clusterId} was not found in the subgraph`);
  }

  return {
    cluster: payload.cluster,
    source,
  };
}

export async function fetchSubgraphCluster(
  primaryUrl: string,
  fallbackUrl: string | undefined,
  clusterId: string,
  fetchFn: typeof fetch = fetch,
): Promise<SubgraphClusterResult> {
  try {
    return await fetchSubgraphClusterOnce(primaryUrl, clusterId, "primary", fetchFn);
  } catch (primaryError) {
    if (!fallbackUrl) {
      throw primaryError;
    }

    return fetchSubgraphClusterOnce(fallbackUrl, clusterId, "fallback", fetchFn);
  }
}
