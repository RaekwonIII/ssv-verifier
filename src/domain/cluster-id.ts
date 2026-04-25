const allowedOperatorCounts = new Set([4, 7, 10, 13]);

export interface ParsedClusterId {
  ownerAddress: string;
  operatorIds: bigint[];
  canonicalId: string;
}

function parseOwnerAddress(ownerAddress: string): string {
  if (!/^0x[0-9a-f]{40}$/.test(ownerAddress)) {
    throw new Error("Invalid --cluster owner segment. Expected a lowercased 0x-prefixed 40-hex-character address.");
  }

  return ownerAddress;
}

function parseOperatorId(segment: string, index: number): bigint {
  if (!/^[0-9]+$/.test(segment)) {
    throw new Error(`Invalid --cluster operator #${index + 1}. Expected a base-10 positive integer.`);
  }

  if (segment === "0") {
    throw new Error(`Invalid --cluster operator #${index + 1}. Operator IDs must be greater than zero.`);
  }

  if (segment.length > 1 && segment.startsWith("0")) {
    throw new Error(`Invalid --cluster operator #${index + 1}. Operator IDs must be canonical base-10 integers without leading zeroes.`);
  }

  return BigInt(segment);
}

export function parseClusterId(clusterId: string): ParsedClusterId {
  const segments = clusterId.split("-");
  const [ownerAddress, ...operatorSegments] = segments;

  if (!ownerAddress || operatorSegments.length === 0) {
    throw new Error("Invalid --cluster value. Expected <owner>-<operatorId...>.");
  }

  const normalizedOwnerAddress = parseOwnerAddress(ownerAddress);

  if (!allowedOperatorCounts.has(operatorSegments.length)) {
    throw new Error("Invalid --cluster operator count. Expected exactly 4, 7, 10, or 13 operator IDs.");
  }

  const operatorIds = operatorSegments.map((segment, index) => parseOperatorId(segment, index));

  for (let index = 1; index < operatorIds.length; index += 1) {
    const previousOperatorId = operatorIds[index - 1]!;
    const operatorId = operatorIds[index]!;

    if (operatorId === previousOperatorId) {
      throw new Error(`Invalid --cluster operator IDs. Duplicate operator ID ${operatorId.toString()} is not allowed.`);
    }

    if (operatorId < previousOperatorId) {
      throw new Error("Invalid --cluster operator IDs. Operator IDs must be sorted in strictly ascending order.");
    }
  }

  return {
    ownerAddress: normalizedOwnerAddress,
    operatorIds,
    canonicalId: `${normalizedOwnerAddress}-${operatorIds.map((operatorId) => operatorId.toString()).join("-")}`,
  };
}
