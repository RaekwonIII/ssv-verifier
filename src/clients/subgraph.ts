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
    feeAsset
    effectiveBalance
  }
}`;

const pinnedClusterSnapshotQuery = `query ($id: ID!) {
  _meta {
    block {
      number
    }
  }
  cluster(id: $id) {
    id
    owner { id }
    operatorIds
    validatorCount
    networkFeeIndex
    index
    active
    balance
    feeAsset
    effectiveBalance
  }
}`;

const clusterAccountingQuery = `query ($operatorIds: [String!]!, $daoId: ID!) {
  operators(where: { id_in: $operatorIds }) {
    id
    fee
    feeIndex
    feeIndexBlockNumber
    feeSSV
    feeIndexSSV
    feeIndexBlockNumberSSV
  }
  daovalues(id: $daoId) {
    networkFee
    networkFeeIndex
    networkFeeIndexBlockNumber
    liquidationThreshold
    minimumLiquidationCollateral
    networkFeeSSV
    networkFeeIndexSSV
    networkFeeIndexBlockNumberSSV
    liquidationThresholdSSV
    minimumLiquidationCollateralSSV
  }
}`;

const singleOperatorQuery = `query ($id: ID!) {
  operator(id: $id) {
    id
    fee
    feeSSV
    validatorCount
    removed
  }
}`;

const daoValuesQuery = `query ($daoId: ID!) {
  daovalues(id: $daoId) {
    networkFee
    networkFeeSSV
    liquidationThreshold
    liquidationThresholdSSV
    minimumLiquidationCollateral
    minimumLiquidationCollateralSSV
  }
}`;

const clusterIdsQuery = `query ($first: Int!, $skip: Int!) {
  clusters(first: $first, skip: $skip, orderBy: id, orderDirection: asc) {
    id
  }
}`;

const operatorDetailsPageQuery = `query ($first: Int!, $skip: Int!) {
  operators(first: $first, skip: $skip, orderBy: id, orderDirection: asc) {
    id
    fee
    feeSSV
    validatorCount
    removed
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
  feeAsset?: string | null;
  effectiveBalance?: string | null;
}

export interface SubgraphClusterResult {
  cluster: SubgraphClusterRecord;
}

export interface SubgraphOperatorRecord {
  id: string;
  fee: string;
  feeIndex: string;
  feeIndexBlockNumber: string;
  feeSSV?: string;
  feeIndexSSV?: string;
  feeIndexBlockNumberSSV?: string;
}

export interface SubgraphDaoValuesRecord {
  networkFee: string;
  networkFeeIndex: string;
  networkFeeIndexBlockNumber: string;
  liquidationThreshold: string;
  minimumLiquidationCollateral: string;
  networkFeeSSV: string;
  networkFeeIndexSSV: string;
  networkFeeIndexBlockNumberSSV: string;
  liquidationThresholdSSV: string;
  minimumLiquidationCollateralSSV: string;
}

export interface SubgraphOperatorDetailsRecord {
  id: string;
  fee: string | null;
  feeSSV: string | null;
  validatorCount: string | null;
  removed: boolean | null;
}

export interface SubgraphClusterAccountingResult {
  cluster: SubgraphClusterRecord;
  operators: SubgraphOperatorRecord[];
  daoValues: SubgraphDaoValuesRecord;
  indexedBlockNumber: number;
}

interface SubgraphClusterSnapshotPayload {
  _meta?: {
    block?: {
      number?: number;
    };
  };
  cluster: SubgraphClusterRecord | null;
}

export interface SubgraphClusterSnapshotSuccessResult {
  status: "success";
  cluster: SubgraphClusterRecord;
  operators: SubgraphOperatorRecord[];
  daoValues: SubgraphDaoValuesRecord | null;
  indexedBlockNumber: number;
}

export interface SubgraphClusterSnapshotNotFoundResult {
  status: "not-found";
  clusterId: string;
  indexedBlockNumber: number;
}

export interface SubgraphClusterSnapshotQueryFailedResult {
  status: "query-failed";
  detail: string;
}

export type SubgraphClusterSnapshotResult =
  | SubgraphClusterSnapshotSuccessResult
  | SubgraphClusterSnapshotNotFoundResult
  | SubgraphClusterSnapshotQueryFailedResult;

export interface SubgraphClusterIdsResult {
  clusterIds: string[];
}

export interface SubgraphOperatorDetailsListResult {
  operators: SubgraphOperatorDetailsRecord[];
}

export interface SubgraphOperatorDetailsResult {
  operator: SubgraphOperatorDetailsRecord;
}

export interface SubgraphDaoValuesResult {
  daoValues: Pick<
    SubgraphDaoValuesRecord,
    | "networkFee"
    | "liquidationThreshold"
    | "minimumLiquidationCollateral"
    | "networkFeeSSV"
    | "liquidationThresholdSSV"
    | "minimumLiquidationCollateralSSV"
  >;
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

export async function fetchSubgraphMeta(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<SubgraphMetaResult> {
  const payload = await postGraphql<SubgraphMetaResponse["data"]>(url, metaQuery, {}, fetchFn);
  const blockNumber = payload?._meta?.block?.number;

  if (typeof blockNumber !== "number") {
    throw new Error("Subgraph response did not include _meta.block.number");
  }

  return {
    indexedBlockNumber: blockNumber,
  };
}

export async function fetchSubgraphCluster(
  url: string,
  clusterId: string,
  fetchFn: typeof fetch = fetch,
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
  };
}

export async function fetchPinnedSubgraphClusterSnapshot(
  url: string,
  clusterId: string,
  daoAddress: string,
  fetchFn: typeof fetch = fetch,
): Promise<SubgraphClusterSnapshotResult> {
  try {
    const payload = await postGraphql<SubgraphClusterSnapshotPayload>(
      url,
      pinnedClusterSnapshotQuery,
      { id: clusterId },
      fetchFn,
    );
    const indexedBlockNumber = payload._meta?.block?.number;

    if (typeof indexedBlockNumber !== "number") {
      return {
        status: "query-failed",
        detail: "Subgraph response did not include _meta.block.number",
      };
    }

    const clusterPayload = payload.cluster === undefined
      ? (await postGraphql<{ cluster: SubgraphClusterRecord | null }>(
          url,
          singleClusterQuery,
          { id: clusterId },
          fetchFn,
        )).cluster
      : payload.cluster;

    if (!clusterPayload) {
      return {
        status: "not-found",
        clusterId,
        indexedBlockNumber,
      };
    }

    const accountingPayload = await postGraphql<{
      operators?: SubgraphOperatorRecord[];
      daovalues?: SubgraphDaoValuesRecord | null;
    }>(
      url,
      clusterAccountingQuery,
      { operatorIds: clusterPayload.operatorIds, daoId: daoAddress },
      fetchFn,
    );

    return {
      status: "success",
      cluster: clusterPayload,
      operators: accountingPayload.operators ?? [],
      daoValues: accountingPayload.daovalues ?? null,
      indexedBlockNumber,
    };
  } catch (error) {
    return {
      status: "query-failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function fetchSubgraphClusterAccounting(
  url: string,
  clusterId: string,
  daoAddress: string,
  fetchFn: typeof fetch = fetch,
): Promise<SubgraphClusterAccountingResult> {
  const result = await fetchPinnedSubgraphClusterSnapshot(url, clusterId, daoAddress, fetchFn);

  if (result.status === "query-failed") {
    throw new Error(result.detail);
  }

  if (result.status === "not-found") {
    throw new Error(`Cluster ${clusterId} was not found in the subgraph`);
  }

  const missingOperatorIds = result.cluster.operatorIds.filter(
    (operatorId) => !result.operators.some((operator) => operator.id === operatorId),
  );

  if (missingOperatorIds.length > 0) {
    throw new Error(`Subgraph response was missing operators: ${missingOperatorIds.join(", ")}`);
  }

  if (!result.daoValues) {
    throw new Error(`Subgraph response did not include DAO values for ${daoAddress}`);
  }

  return {
    cluster: result.cluster,
    operators: result.operators,
    daoValues: result.daoValues,
    indexedBlockNumber: result.indexedBlockNumber,
  };
}

export async function fetchSubgraphOperator(
  url: string,
  operatorId: string,
  fetchFn: typeof fetch = fetch,
): Promise<SubgraphOperatorDetailsResult> {
  const payload = await postGraphql<{ operator: SubgraphOperatorDetailsRecord | null }>(
    url,
    singleOperatorQuery,
    { id: operatorId },
    fetchFn,
  );

  if (!payload.operator) {
    throw new Error(`Operator ${operatorId} was not found in the subgraph`);
  }

  return {
    operator: payload.operator,
  };
}

export async function fetchSubgraphDaoValues(
  url: string,
  daoAddress: string,
  fetchFn: typeof fetch = fetch,
): Promise<SubgraphDaoValuesResult> {
  const payload = await postGraphql<{ daovalues?: SubgraphDaoValuesResult["daoValues"] | null }>(
    url,
    daoValuesQuery,
    { daoId: daoAddress },
    fetchFn,
  );

  if (!payload.daovalues) {
    throw new Error(`Subgraph response did not include DAO values for ${daoAddress}`);
  }

  return {
    daoValues: payload.daovalues,
  };
}

export async function fetchAllSubgraphClusterIds(
  url: string,
  fetchFn: typeof fetch = fetch,
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
      };
    }

    skip += page.length;
  }
}

export async function fetchAllSubgraphOperatorDetails(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<SubgraphOperatorDetailsListResult> {
  const operators: SubgraphOperatorDetailsRecord[] = [];
  let skip = 0;
  const first = 1000;

  while (true) {
    const payload = await postGraphql<{ operators?: SubgraphOperatorDetailsRecord[] }>(
      url,
      operatorDetailsPageQuery,
      { first, skip },
      fetchFn,
    );
    const page = payload.operators ?? [];

    operators.push(...page);

    if (page.length < first) {
      return {
        operators,
      };
    }

    skip += page.length;
  }
}
