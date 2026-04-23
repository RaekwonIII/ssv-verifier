import { describe, expect, it } from "vitest";

import { exitCodeForStatus, summarizeStatuses } from "../src/status.js";

describe("summarizeStatuses", () => {
  it("prioritizes fail over every other status", () => {
    expect(summarizeStatuses(["pass", "warn", "inconclusive", "fail"])).toBe("fail");
  });

  it("prioritizes inconclusive over warn", () => {
    expect(summarizeStatuses(["pass", "warn", "inconclusive"])).toBe("inconclusive");
  });

  it("keeps warn as a zero-exit non-pass status", () => {
    expect(summarizeStatuses(["pass", "warn"])).toBe("warn");
  });
});

describe("exitCodeForStatus", () => {
  it("returns zero for pass and warn", () => {
    expect(exitCodeForStatus("pass")).toBe(0);
    expect(exitCodeForStatus("warn")).toBe(0);
  });

  it("returns non-zero for fail and inconclusive", () => {
    expect(exitCodeForStatus("fail")).toBe(1);
    expect(exitCodeForStatus("inconclusive")).toBe(1);
  });
});
