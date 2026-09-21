import type { ToolDefinition } from "./types.js";
import { estimateTokens } from "./compressor.js";

export type BudgetCandidate<T = ToolDefinition> = {
  value: T;
  cost: number;
  pinned?: boolean;
};

/**
 * BudgetGuard is the single admission controller for tool context.
 * It never re-estimates a candidate: callers provide the exact cost of the
 * representation that will be exposed to the model.
 */
export class BudgetGuard<T = ToolDefinition> {
  private used = 0;
  private admitted: BudgetCandidate<T>[] = [];

  constructor(private readonly limit: number) {
    if (!Number.isFinite(limit) || limit <= 0) throw new Error("BudgetGuard limit must be a positive finite number");
  }

  get budgetUsed(): number { return this.used; }
  get remaining(): number { return Math.max(0, this.limit - this.used); }
  get items(): readonly BudgetCandidate<T>[] { return this.admitted; }

  tryAdmit(candidate: BudgetCandidate<T>): boolean {
    if (!Number.isFinite(candidate.cost) || candidate.cost < 0) return false;
    if (this.used + candidate.cost > this.limit) return false;
    this.admitted.push(candidate);
    this.used += candidate.cost;
    return true;
  }

  admitPinned(candidate: BudgetCandidate<T>, allowOverflow = false): boolean {
    if (!candidate.pinned) return this.tryAdmit(candidate);
    if (this.tryAdmit(candidate)) return true;
    if (!allowOverflow) return false;
    this.admitted.push(candidate);
    this.used += candidate.cost;
    return true;
  }

  canFit(cost: number): boolean {
    return Number.isFinite(cost) && cost >= 0 && this.used + cost <= this.limit;
  }
}

export const exactToolCost = (tool: ToolDefinition): number =>
  estimateTokens(JSON.stringify(tool));
