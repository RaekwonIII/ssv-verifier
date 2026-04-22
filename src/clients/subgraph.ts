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

const clusterAccountingQuery = `query ($operatorIds: [String!]!, $daoId: ID!) {
  operators(where: { id_in: $operatorIds }) {
    id
    fee
    feeIndex
    feeIndexBlockNumber
  }
  daovalues(id: $daoId) {
    networkFee
    networkFeeIndex
    networkFeeIndexBlockNumber
    liquidationThreshold
    minimumLiquidationCollateral
  }
}`;

const clusterIdsQuery = `query ($first: Int!, $skip: Int!) {
  clusters(first: $first, skip: $skip, orderBy: id, orderDirection: asc) {
    id
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

export interface SubgraphOperatorRecord {
  id: string;
  fee: string;
  feeIndex: string;
  feeIndexBlockNumber: string;
}

export interface SubgraphDaoValuesRecord {
  networkFee: string;
  networkFeeIndex: string;
  networkFeeIndexBlockNumber: string;
  liquidationThreshold: string;
  minimumLiquidationCollateral: string;
}

export interface SubgraphClusterAccountingResult {
  cluster: SubgraphClusterRecord;
  operators: SubgraphOperatorRecord[];
  daoValues: SubgraphDaoValuesRecord;
  source: "primary" | "fallback";
}

export interface SubgraphClusterIdsResult {
  clusterIds: string[];
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

async function fetchSubgraphClusterAccountingOnce(
  url: string,
  clusterId: string,
  daoAddress: string,
  source: "primary" | "fallback",
  fetchFn: typeof fetch,
): Promise<SubgraphClusterAccountingResult> {
  const clusterResult = await fetchSubgraphClusterOnce(url, clusterId, source, fetchFn);
  const payload = await postGraphql<{
    operators?: SubgraphOperatorRecord[];
    daovalues?: SubgraphDaoValuesRecord | null;
  }>(
    url,
    clusterAccountingQuery,
    { operatorIds: clusterResult.cluster.operatorIds, daoId: daoAddress },
    fetchFn,
  );
  const operators = payload.operators ?? [];
  const missingOperatorIds = clusterResult.cluster.operatorIds.filter(
    (operatorId) => !operators.some((operator) => operator.id === operatorId),
  );

  if (missingOperatorIds.length > 0) {
    throw new Error(`Subgraph response was missing operators: ${missingOperatorIds.join(", ")}`);
  }

  if (!payload.daovalues) {
    throw new Error(`Subgraph response did not include DAO values for ${daoAddress}`);
  }

  return {
    cluster: clusterResult.cluster,
    operators,
    daoValues: payload.daovalues,
    source,
  };
}

export async function fetchSubgraphClusterAccounting(
  primaryUrl: string,
  fallbackUrl: string | undefined,
  clusterId: string,
  daoAddress: string,
  fetchFn: typeof fetch = fetch,
): Promise<SubgraphClusterAccountingResult> {
  try {
    return await fetchSubgraphClusterAccountingOnce(primaryUrl, clusterId, daoAddress, "primary", fetchFn);
  } catch (primaryError) {
    if (!fallbackUrl) {
      throw primaryError;
    }

    return fetchSubgraphClusterAccountingOnce(fallbackUrl, clusterId, daoAddress, "fallback", fetchFn);
  }
}

async function fetchAllSubgraphClusterIdsOnce(
  url: string,
  source: "primary" | "fallback",
  fetchFn: typeof fetch,
): Promise<SubgraphClusterIdsResult> {
  const clusterIds: string[] = [];
  let skip = 0;
  const first = 1000;

  while (true) {
    const payload = await postGraphql<{ clusters?: Array<{ id: string }> }>(
      url,
      clusterIdsQuery,
      { first, skip },
      fetchFn,
    );
    const page = payload.clusters ?? [];

    clusterIds.push(...page.map((cluster) => cluster.id));

    if (page.length < first) {
      return {
        clusterIds,
        source,
      };
    }

    skip += page.length;
  }
}

export async function fetchAllSubgraphClusterIds(
  primaryUrl: string,
  fallbackUrl: string | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<SubgraphClusterIdsResult> {
  try {
    return await fetchAllSubgraphClusterIdsOnce(primaryUrl, "primary", fetchFn);
  } catch (primaryError) {
    if (!fallbackUrl) {
      throw primaryError;
    }

    return fetchAllSubgraphClusterIdsOnce(fallbackUrl, "fallback", fetchFn);
  }
}
