export type CheckStatus = "pass" | "warn" | "fail" | "inconclusive";

export function summarizeStatuses(statuses: Iterable<CheckStatus>): CheckStatus {
  const collected = [...statuses];

  if (collected.includes("fail")) {
    return "fail";
  }

  if (collected.includes("inconclusive")) {
    return "inconclusive";
  }

  if (collected.includes("warn")) {
    return "warn";
  }

  return "pass";
}

export function exitCodeForStatus(status: CheckStatus): 0 | 1 {
  return status === "pass" || status === "warn" ? 0 : 1;
}
