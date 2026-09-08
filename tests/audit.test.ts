import { describe, expect, it } from "vitest";
import { hashArgs, segmentTasks, stableStringify, summarizeAudit } from "../src/audit.js";
import type { AuditRecord } from "../src/types.js";

const T0 = 1757000000000;

const rec = (overrides: Partial<AuditRecord> = {}): AuditRecord => ({
  ts: T0,
  session: "s1",
  server: "alpha",
  tool: "alpha_tool_0",
  argsHash: "h",
  reqChars: 10,
  outChars: 100,
  isError: false,
  durationMs: 5,
  ...overrides,
});

describe("stableStringify", () => {
  it("orders object keys", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it("handles nesting, arrays and primitives", () => {
    expect(stableStringify({ x: [3, 2], y: null })).toBe('{"x":[3,2],"y":null}');
    expect(stableStringify("s")).toBe('"s"');
    expect(stableStringify(undefined)).toBe("null");
  });

  it("survives circular structures", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(() => stableStringify(obj)).not.toThrow();
    expect(stableStringify(obj)).toContain("[Circular]");
  });
});

describe("hashArgs", () => {
  it("is key-order invariant and hex sha1", () => {
    const a = hashArgs({ id: "x", limit: 3 });
    expect(hashArgs({ limit: 3, id: "x" })).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
  });

  it("differs across values and never throws", () => {
    expect(hashArgs({ id: "x" })).not.toBe(hashArgs({ id: "y" }));
    const circular: Record<string, unknown> = {};
    circular.me = circular;
    expect(hashArgs(circular)).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("segmentTasks", () => {
  it("splits on idle gaps and never merges sessions", () => {
    const records = [
      rec({ ts: T0 }),
      rec({ ts: T0 + 10_000 }),
      rec({ ts: T0 + 500_000 }),
      rec({ ts: T0 + 510_000, session: "s2" }),
      rec({ ts: T0 + 520_000, session: "s1" }),
    ];
    const tasks = segmentTasks(records, 120);
    expect(tasks).toHaveLength(4);
    expect(tasks[0].calls).toBe(2);
    expect(tasks[1].session).toBe("s1");
    expect(tasks[2].session).toBe("s2");
    expect(tasks[3].session).toBe("s1");
    expect(tasks[0].id).toBe("task-1");
  });

  it("sorts unsorted input and keeps single-call tasks", () => {
    const tasks = segmentTasks([rec({ ts: T0 + 5_000 }), rec({ ts: T0 })], 120);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].startTs).toBe(T0);
    expect(tasks[0].endTs).toBe(T0 + 5_000);
  });
});

describe("summarizeAudit", () => {
  it("aggregates totals, tools, duplicates and error waste", () => {
    const records = [
      rec({ ts: T0, argsHash: "same", outChars: 400 }),
      rec({ ts: T0 + 1_000, argsHash: "same", outChars: 400 }),
      rec({ ts: T0 + 2_000, tool: "alpha_tool_9", argsHash: "other", outChars: 100, isError: true }),
      rec({ ts: T0 + 3_000, server: "beta", tool: "beta_tool_1", argsHash: "b1", outChars: 200 }),
    ];
    const summary = summarizeAudit(records, 120);
    expect(summary.totalCalls).toBe(4);
    expect(summary.totalOutChars).toBe(1100);
    expect(summary.totalErrors).toBe(1);
    expect(summary.dupWasteChars).toBe(400);
    expect(summary.errorWasteChars).toBe(100);
    expect(summary.tools).toHaveLength(3);
    expect(summary.tools.find((row) => row.key === "alpha::alpha_tool_0")).toMatchObject({ calls: 2, errors: 0, dupCalls: 2 });
    expect(summary.tools[0].key).toBe("alpha::alpha_tool_0");
  });
});
