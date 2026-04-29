import { describe, expect, it } from "vitest";

import { parseClusterId } from "../src/domain/cluster-id.js";

describe("parseClusterId", () => {
  const owner = "0xe8c927a1fa792eddefe23fda643a62e03f999830";

  it("returns canonical cluster id for valid input", () => {
    const parsed = parseClusterId(`${owner}-5-6-7-523`);
    expect(parsed).toEqual({
      ownerAddress: owner,
      operatorIds: [5n, 6n, 7n, 523n],
      canonicalId: `${owner}-5-6-7-523`,
    });
  });

  it("rejects non-lowercased owner addresses", () => {
    expect(() => parseClusterId(`0xE8C927A1Fa792eddefe23fda643A62E03f999830-5-6-7-523`)).toThrow(/owner segment/);
  });

  it("rejects unsupported operator counts", () => {
    expect(() => parseClusterId(`${owner}-5-6-7`)).toThrow(/operator count/);
    expect(() => parseClusterId(`${owner}-1-2-3-4-5`)).toThrow(/operator count/);
  });

  it("rejects non-canonical operator IDs", () => {
    expect(() => parseClusterId(`${owner}-5-06-7-8`)).toThrow(/canonical base-10/);
    expect(() => parseClusterId(`${owner}-5-6-7-0`)).toThrow(/greater than zero/);
    expect(() => parseClusterId(`${owner}-a-6-7-8`)).toThrow(/base-10 positive integer/);
  });

  it("rejects unsorted or duplicate operator IDs", () => {
    expect(() => parseClusterId(`${owner}-5-7-6-8`)).toThrow(/strictly ascending/);
    expect(() => parseClusterId(`${owner}-5-5-6-7`)).toThrow(/Duplicate operator ID 5/);
  });

  it("rejects malformed cluster shapes", () => {
    expect(() => parseClusterId("not-a-cluster")).toThrow();
    expect(() => parseClusterId(`${owner}`)).toThrow();
  });
});
