import { describe, expect, it } from "vitest";
import { compactPersistedNumber, compactPersistedNumberTuple } from "./compact-number";

describe("compact persisted numbers", () => {
  it("removes floating point tails while preserving useful tiny values", () => {
    expect(compactPersistedNumber(0.022000000000000006)).toBe(0.022);
    expect(compactPersistedNumber(0.002336656972313501)).toBe(0.00233666);
    expect(compactPersistedNumber(0.000000123456789)).toBe(0.000000123457);
  });

  it("compacts vector tuples used in persisted registered parts", () => {
    expect(compactPersistedNumberTuple([
      0.005119999999999002,
      0.016399999999999998,
      0.002,
    ])).toEqual([0.00512, 0.0164, 0.002]);
  });
});
