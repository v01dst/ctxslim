import { describe, expect, it } from "vitest";
import { PRICE_AS_OF, PRICE_TABLE, dollarsFor, familyNames, parsePricesFile } from "../src/pricing.js";

describe("pricing", () => {
  it("ships a stamped table with positive rates", () => {
    expect(PRICE_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(PRICE_TABLE.length).toBeGreaterThanOrEqual(4);
    for (const row of PRICE_TABLE) {
      expect(row.inputPer1M).toBeGreaterThan(0);
      expect(row.outputPer1M).toBeGreaterThan(0);
    }
    expect(familyNames(PRICE_TABLE)).toContain("sonnet");
  });

  it("prices tokens", () => {
    expect(dollarsFor(1_000_000, 3)).toBe(3);
    expect(dollarsFor(8_500, 3)).toBeCloseTo(0.0255, 4);
  });

  it("parses override files and rejects garbage", () => {
    const rows = parsePricesFile([{ family: "mine", inputPer1M: 1, outputPer1M: 2 }]);
    expect(rows).toEqual([{ family: "mine", inputPer1M: 1, outputPer1M: 2 }]);
    expect(() => parsePricesFile({ no: "array" })).toThrow();
    expect(() => parsePricesFile([{ family: "x", inputPer1M: -1, outputPer1M: 2 }])).toThrow();
    expect(() => parsePricesFile([{ family: "", inputPer1M: 1, outputPer1M: 2 }])).toThrow();
  });
});
