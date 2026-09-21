import { describe, expect, it } from "vitest";
import { BudgetGuard, exactToolCost } from "../src/budget.js";

describe("BudgetGuard", () => {
  it("never admits a candidate that exceeds the hard budget", () => {
    const guard = new BudgetGuard(100);
    expect(guard.tryAdmit({ value: "large", cost: 101 })).toBe(false);
    expect(guard.budgetUsed).toBe(0);
    expect(guard.remaining).toBe(100);
  });

  it("admits candidates until the exact budget is consumed", () => {
    const guard = new BudgetGuard(100);
    expect(guard.tryAdmit({ value: "a", cost: 40 })).toBe(true);
    expect(guard.tryAdmit({ value: "b", cost: 60 })).toBe(true);
    expect(guard.tryAdmit({ value: "c", cost: 1 })).toBe(false);
    expect(guard.budgetUsed).toBe(100);
    expect(guard.remaining).toBe(0);
  });

  it("does not silently overflow for pinned candidates", () => {
    const guard = new BudgetGuard(50);
    expect(guard.admitPinned({ value: "pinned", cost: 60, pinned: true })).toBe(false);
    expect(guard.budgetUsed).toBe(0);
  });
});

describe("exactToolCost", () => {
  it("measures the representation that will actually be exposed", () => {
    const tool = { name: "demo", description: "hello", inputSchema: { type: "object" } };
    expect(exactToolCost(tool)).toBe(Math.ceil(JSON.stringify(tool).length / 4));
  });
});
