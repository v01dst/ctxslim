# CtxSlim Audit (v0.4.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meter every proxied tool call (sizes, arg-hash, errors, timing) into `audit.jsonl` and ship `ctxslim audit` — per-task dollar spend across model families with duplicate/error waste sections.

**Architecture:** `handleCallTool` gains one guarded append per upstream attempt (success + throw paths only). Pure logic lives in `src/audit.ts` (hashing, task segmentation, aggregation) and `src/pricing.ts` (multi-family rate table); file I/O follows the existing `stats.jsonl`/`usage.json` pattern in `src/config.ts`; rendering follows the `printStats` pattern in `src/index.ts`.

**Tech Stack:** TypeScript (ESM, Node ≥18), `@modelcontextprotocol/sdk` ^1.29, vitest. No new dependencies (only `node:crypto`, `node:fs` builtins).

**Spec:** docs/superpowers/specs/2026-09-08-ctxslim-audit-design.md

## Global Constraints

- No code comments in source or tests.
- No new runtime dependencies; `node:crypto` and `node:fs` builtins only.
- All 87 existing tests must keep passing.
- Metering never breaks calls: every new code path on the proxy hot path is try/catch-guarded and degrades to a no-op.
- Never store raw args or payload content — sizes and SHA-1 hashes only.
- Sandbox quirk: run vitest only as `node_modules/.bin/vitest run --no-file-parallelism < /dev/null > /tmp/opencode/<name>.txt 2>&1`, then read the file. Never a bare foreground full-suite run.
- Sandbox quirk: the Go tool-runner crashes under sustained load — launch heavy runs detached with `nohup ... &`, poll with short `sleep` + `tail`, never one giant blocking call.
- Sandbox quirk: git/npm output may hang — redirect to files (`> /tmp/opencode/<name>.txt 2>&1`).
- No emojis in code, tests, or CLI output.

---

### Task 1: Audit record type + file I/O

**Files:**
- Modify: `src/types.ts` (append AuditRecord)
- Modify: `src/config.ts` (append auditFilePath, appendAuditLine, loadAuditRecords; extend `node:fs` import with nothing new — readFileSync/existsSync/appendFileSync/mkdirSync already imported)
- Test: `tests/audit-io.test.ts` (create)

**Interfaces:**
- Consumes: `statsDir()` (private, reused internally).
- Produces: `AuditRecord` from `src/types.ts`; `auditFilePath(): string`, `appendAuditLine(record: AuditRecord): void`, `loadAuditRecords(): { records: AuditRecord[]; corrupt: number }` from `src/config.ts`.

- [ ] **Step 1: Write failing tests**

Create `tests/audit-io.test.ts`:

```typescript
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendAuditLine, auditFilePath, loadAuditRecords } from "../src/config.js";
import type { AuditRecord } from "../src/types.js";

const makeRecord = (overrides: Partial<AuditRecord> = {}): AuditRecord => ({
  ts: 1757000000000,
  session: "2026-09-08T00:00:00.000Z",
  server: "alpha",
  tool: "alpha_tool_0",
  argsHash: "abc123",
  reqChars: 48,
  outChars: 900,
  isError: false,
  durationMs: 12,
  ...overrides,
});

describe("audit file io", () => {
  const original = process.env.CTX_SLIM_STATS_DIR;
  afterEach(() => {
    if (original === undefined) delete process.env.CTX_SLIM_STATS_DIR;
    else process.env.CTX_SLIM_STATS_DIR = original;
  });

  it("round-trips records", () => {
    process.env.CTX_SLIM_STATS_DIR = mkdtempSync(join(tmpdir(), "ctxslim-auditio-"));
    appendAuditLine(makeRecord());
    appendAuditLine(makeRecord({ tool: "alpha_tool_1", isError: true }));
    const { records, corrupt } = loadAuditRecords();
    expect(corrupt).toBe(0);
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({ tool: "alpha_tool_1", isError: true });
  });

  it("returns empty when no file exists", () => {
    process.env.CTX_SLIM_STATS_DIR = join(mkdtempSync(join(tmpdir(), "ctxslim-auditio-")), "missing-dir");
    expect(loadAuditRecords()).toEqual({ records: [], corrupt: 0 });
  });

  it("skips corrupt lines and counts them", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctxslim-auditio-"));
    process.env.CTX_SLIM_STATS_DIR = dir;
    appendAuditLine(makeRecord());
    writeFileSync(auditFilePath(), "{not json\n" + JSON.stringify({ ...makeRecord(), outChars: "huge" }) + "\n", { flag: "a" });
    const { records, corrupt } = loadAuditRecords();
    expect(records).toHaveLength(1);
    expect(corrupt).toBe(2);
  });

  it("never throws on unwritable dir", () => {
    process.env.CTX_SLIM_STATS_DIR = "/proc/ctxslim-nope";
    expect(() => appendAuditLine(makeRecord())).not.toThrow();
    expect(loadAuditRecords()).toEqual({ records: [], corrupt: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node_modules/.bin/vitest run tests/audit-io.test.ts --no-file-parallelism < /dev/null > /tmp/opencode/test-audit-io-red.txt 2>&1`
Expected: FAIL — `appendAuditLine`/`auditFilePath`/`loadAuditRecords` not exported, `AuditRecord` type missing.

- [ ] **Step 3: Implement types + config I/O**

`src/types.ts` — append:

```typescript
export type AuditRecord = {
  ts: number;
  session: string;
  server: string;
  tool: string;
  argsHash: string;
  reqChars: number;
  outChars: number;
  isError: boolean;
  durationMs: number;
};
```

`src/config.ts` — append at end:

```typescript
export const auditFilePath = (): string => join(statsDir(), "audit.jsonl");

export const appendAuditLine = (record: AuditRecord): void => {
  try {
    const dir = statsDir();
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "audit.jsonl"), JSON.stringify(record) + "\n");
  } catch {
    return;
  }
};

const isAuditRecord = (value: unknown): value is AuditRecord => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.ts === "number" &&
    Number.isFinite(record.ts) &&
    typeof record.session === "string" &&
    typeof record.server === "string" &&
    typeof record.tool === "string" &&
    typeof record.argsHash === "string" &&
    typeof record.reqChars === "number" &&
    Number.isFinite(record.reqChars) &&
    typeof record.outChars === "number" &&
    Number.isFinite(record.outChars) &&
    typeof record.isError === "boolean" &&
    typeof record.durationMs === "number" &&
    Number.isFinite(record.durationMs)
  );
};

export const loadAuditRecords = (): { records: AuditRecord[]; corrupt: number } => {
  try {
    const file = auditFilePath();
    if (!existsSync(file)) return { records: [], corrupt: 0 };
    const records: AuditRecord[] = [];
    let corrupt = 0;
    for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
      try {
        const parsed: unknown = JSON.parse(line);
        if (isAuditRecord(parsed)) records.push(parsed);
        else corrupt += 1;
      } catch {
        corrupt += 1;
      }
    }
    return { records, corrupt };
  } catch {
    return { records: [], corrupt: 0 };
  }
};
```

Add `import type { AuditRecord } from "./types.js";` — merge into the existing type import on line 5 (`import type { ContextSlimConfig, ServerEntry, SlimConfig, SlimMode, ToolDefinition } from "./types.js";`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node_modules/.bin/vitest run tests/audit-io.test.ts --no-file-parallelism < /dev/null > /tmp/opencode/test-audit-io.txt 2>&1`
Expected: PASS (4/4). Then full suite detached: `nohup node_modules/.bin/vitest run --no-file-parallelism < /dev/null > /tmp/opencode/test-t1.txt 2>&1 &`, poll until the `Tests` summary line appears. Expected: all pass (87 + 4 = 91).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/config.ts tests/audit-io.test.ts > /tmp/opencode/git-t1.txt 2>&1
git commit -m "feat: audit record type and audit.jsonl file io" > /tmp/opencode/git-t1.txt 2>&1
```

---

### Task 2: Hashing, segmentation, aggregation

**Files:**
- Create: `src/audit.ts`
- Test: `tests/audit.test.ts` (create)

**Interfaces:**
- Consumes: `AuditRecord` from `src/types.ts`; `estimateTokens` from `src/compressor.ts`.
- Produces from `src/audit.ts`: `stableStringify(value: unknown): string`, `hashArgs(args: unknown): string`, `segmentTasks(records: AuditRecord[], gapSeconds: number): TaskRecord[]`, `summarizeAudit(records: AuditRecord[], gapSeconds: number): AuditSummary`, plus types `TaskRecord`, `ToolRow`, `DupGroup`, `AuditSummary`. Later tasks (CLI pricing/report) consume exactly these names.

- [ ] **Step 1: Write failing tests**

Create `tests/audit.test.ts`:

```typescript
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
    expect(tasks).toHaveLength(3);
    expect(tasks[0].calls).toBe(2);
    expect(tasks[1].session).toBe("s2");
    expect(tasks[2].session).toBe("s1");
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node_modules/.bin/vitest run tests/audit.test.ts --no-file-parallelism < /dev/null > /tmp/opencode/test-audit-red.txt 2>&1`
Expected: FAIL — cannot resolve `../src/audit.js`.

- [ ] **Step 3: Implement `src/audit.ts`**

```typescript
import { createHash } from "node:crypto";
import type { AuditRecord } from "./types.js";

export const stableStringify = (value: unknown, seen: Set<object> = new Set()): string => {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (seen.has(value)) return '"[Circular]"';
  seen.add(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item, seen)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const body = keys.map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key], seen)}`).join(",");
  seen.delete(value);
  return `{${body}}`;
};

export const hashArgs = (args: unknown): string => {
  try {
    return createHash("sha1").update(stableStringify(args)).digest("hex");
  } catch {
    return createHash("sha1").update("unhashable").digest("hex");
  }
};

export type DupGroup = {
  key: string;
  server: string;
  tool: string;
  count: number;
  outChars: number;
  wasteChars: number;
};

export type TaskRecord = {
  id: string;
  session: string;
  startTs: number;
  endTs: number;
  calls: number;
  reqChars: number;
  outChars: number;
  errors: number;
  dups: DupGroup[];
  byServer: Record<string, number>;
};

export const segmentTasks = (records: AuditRecord[], gapSeconds: number): TaskRecord[] => {
  const sorted = [...records].sort((a, b) => a.ts - b.ts);
  const tasks: TaskRecord[] = [];
  let current: AuditRecord[] = [];
  const flush = (): void => {
    if (current.length === 0) return;
    const first = current[0];
    const groups = new Map<string, { server: string; tool: string; count: number; outChars: number }>();
    for (const record of current) {
      const key = `${record.server}::${record.tool}::${record.argsHash}`;
      const group = groups.get(key) ?? { server: record.server, tool: record.tool, count: 0, outChars: 0 };
      group.count += 1;
      group.outChars += record.outChars;
      groups.set(key, group);
    }
    const dups: DupGroup[] = [];
    for (const [key, group] of groups) {
      if (group.count > 1) {
        dups.push({ key, server: group.server, tool: group.tool, count: group.count, outChars: group.outChars, wasteChars: Math.round((group.outChars * (group.count - 1)) / group.count) });
      }
    }
    const byServer: Record<string, number> = {};
    for (const record of current) {
      byServer[record.server] = (byServer[record.server] ?? 0) + 1;
    }
    tasks.push({
      id: `task-${tasks.length + 1}`,
      session: first.session,
      startTs: first.ts,
      endTs: current[current.length - 1].ts,
      calls: current.length,
      reqChars: current.reduce((sum, record) => sum + record.reqChars, 0),
      outChars: current.reduce((sum, record) => sum + record.outChars, 0),
      errors: current.filter((record) => record.isError).length,
      dups,
      byServer,
    });
    current = [];
  };
  for (const record of sorted) {
    const prev = current[current.length - 1];
    if (prev && (record.session !== prev.session || record.ts - prev.ts > gapSeconds * 1000)) flush();
    current.push(record);
  }
  flush();
  return tasks;
};

export type ToolRow = {
  key: string;
  server: string;
  tool: string;
  calls: number;
  outChars: number;
  reqChars: number;
  errors: number;
  dupCalls: number;
};

export type AuditSummary = {
  tasks: TaskRecord[];
  tools: ToolRow[];
  totalCalls: number;
  totalOutChars: number;
  totalReqChars: number;
  totalErrors: number;
  dupWasteChars: number;
  errorWasteChars: number;
};

export const summarizeAudit = (records: AuditRecord[], gapSeconds: number): AuditSummary => {
  const tasks = segmentTasks(records, gapSeconds);
  const tools = new Map<string, ToolRow>();
  let totalCalls = 0;
  let totalOutChars = 0;
  let totalReqChars = 0;
  let totalErrors = 0;
  let dupWasteChars = 0;
  let errorWasteChars = 0;
  for (const record of records) {
    totalCalls += 1;
    totalOutChars += record.outChars;
    totalReqChars += record.reqChars;
    if (record.isError) {
      totalErrors += 1;
      errorWasteChars += record.outChars;
    }
    const key = `${record.server}::${record.tool}`;
    const row = tools.get(key) ?? { key, server: record.server, tool: record.tool, calls: 0, outChars: 0, reqChars: 0, errors: 0, dupCalls: 0 };
    row.calls += 1;
    row.outChars += record.outChars;
    row.reqChars += record.reqChars;
    if (record.isError) row.errors += 1;
    tools.set(key, row);
  }
  for (const task of tasks) {
    for (const dup of task.dups) {
      dupWasteChars += dup.wasteChars;
      const row = tools.get(`${dup.server}::${dup.tool}`);
      if (row) row.dupCalls += dup.count;
    }
  }
  const toolRows = [...tools.values()].sort((a, b) => b.outChars - a.outChars);
  return { tasks, tools: toolRows, totalCalls, totalOutChars, totalReqChars, totalErrors, dupWasteChars, errorWasteChars };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node_modules/.bin/vitest run tests/audit.test.ts --no-file-parallelism < /dev/null > /tmp/opencode/test-audit.txt 2>&1`
Expected: PASS (all audit tests). Then full suite detached: `nohup node_modules/.bin/vitest run --no-file-parallelism < /dev/null > /tmp/opencode/test-t2.txt 2>&1 &`, poll for the `Tests` summary. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/audit.ts tests/audit.test.ts > /tmp/opencode/git-t2.txt 2>&1
git commit -m "feat: audit hashing, task segmentation and aggregation" > /tmp/opencode/git-t2.txt 2>&1
```

---

### Task 3: Pricing table

**Files:**
- Create: `src/pricing.ts`
- Test: `tests/pricing.test.ts` (create)

**Interfaces:**
- Consumes: nothing (standalone).
- Produces from `src/pricing.ts`: `ModelPrice` type, `PRICE_AS_OF: string`, `PRICE_TABLE: ModelPrice[]`, `parsePricesFile(raw: unknown): ModelPrice[]` (throws on invalid), `dollarsFor(tokens: number, ratePer1M: number): number`, `familyNames(table: ModelPrice[]): string[]`.

Rate values are indicative list-price estimates as of the stamped date (the report labels them estimates; `--prices` overrides). Table:

```typescript
export type ModelPrice = {
  family: string;
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M?: number;
  cacheWritePer1M?: number;
};

export const PRICE_AS_OF = "2026-09-08";

export const PRICE_TABLE: ModelPrice[] = [
  { family: "sonnet", inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 },
  { family: "opus", inputPer1M: 15, outputPer1M: 75, cacheReadPer1M: 1.5, cacheWritePer1M: 18.75 },
  { family: "gpt", inputPer1M: 2.5, outputPer1M: 10 },
  { family: "gemini", inputPer1M: 1.25, outputPer1M: 10 },
  { family: "gemini-flash", inputPer1M: 0.3, outputPer1M: 2.5 },
];
```

- [ ] **Step 1: Write failing tests**

Create `tests/pricing.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node_modules/.bin/vitest run tests/pricing.test.ts --no-file-parallelism < /dev/null > /tmp/opencode/test-pricing-red.txt 2>&1`
Expected: FAIL — cannot resolve `../src/pricing.js`.

- [ ] **Step 3: Implement `src/pricing.ts`**

```typescript
export type ModelPrice = {
  family: string;
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M?: number;
  cacheWritePer1M?: number;
};

export const PRICE_AS_OF = "2026-09-08";

export const PRICE_TABLE: ModelPrice[] = [
  { family: "sonnet", inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 },
  { family: "opus", inputPer1M: 15, outputPer1M: 75, cacheReadPer1M: 1.5, cacheWritePer1M: 18.75 },
  { family: "gpt", inputPer1M: 2.5, outputPer1M: 10 },
  { family: "gemini", inputPer1M: 1.25, outputPer1M: 10 },
  { family: "gemini-flash", inputPer1M: 0.3, outputPer1M: 2.5 },
];

export const dollarsFor = (tokens: number, ratePer1M: number): number => (tokens * ratePer1M) / 1_000_000;

export const familyNames = (table: ModelPrice[]): string[] => table.map((row) => row.family);

const isPriceRow = (value: unknown): value is ModelPrice => {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
  const optionalPositive = (v: unknown): boolean => v === undefined || positive(v);
  return (
    typeof row.family === "string" &&
    row.family.length > 0 &&
    positive(row.inputPer1M) &&
    positive(row.outputPer1M) &&
    optionalPositive(row.cacheReadPer1M) &&
    optionalPositive(row.cacheWritePer1M)
  );
};

export const parsePricesFile = (raw: unknown): ModelPrice[] => {
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isPriceRow)) {
    throw new Error("prices file must be a non-empty array of { family, inputPer1M, outputPer1M } with positive rates");
  }
  return raw.map((row) => ({ ...row }));
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node_modules/.bin/vitest run tests/pricing.test.ts --no-file-parallelism < /dev/null > /tmp/opencode/test-pricing.txt 2>&1`
Expected: PASS. Then full suite detached (`> /tmp/opencode/test-t3.txt`), poll. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/pricing.ts tests/pricing.test.ts > /tmp/opencode/git-t3.txt 2>&1
git commit -m "feat: multi-family pricing table with override parsing" > /tmp/opencode/git-t3.txt 2>&1
```

---

### Task 4: Proxy metering hook

**Files:**
- Modify: `src/server.ts` (imports line 24, `handleCallTool` lines 379-395, new `recordAudit` method)
- Modify: `tests/fake-server.mjs` (`tools/call` case: fail when `arguments.fail === true`)
- Test: `tests/proxy.integration.test.ts` (append metering tests)

**Interfaces:**
- Consumes: `appendAuditLine` from `src/config.js` (Task 1), `hashArgs` from `src/audit.js` (Task 2).
- Produces: `audit.jsonl` lines for every upstream attempt; no new exports (private `recordAudit`).

- [ ] **Step 1: Extend the fake server**

In `tests/fake-server.mjs`, replace the `tools/call` case:

```javascript
case "tools/call": {
  const name = message.params?.name ?? "unknown";
  if (message.params?.arguments?.fail === true) {
    replyError(message.id, -32000, "fake failure");
    break;
  }
  const text = name.endsWith("__big")
    ? `TRUNCATION-SENTINEL${"payload ".repeat(4000)}END-SENTINEL`
    : `${serverName} handled ${name}`;
  reply(message.id, { content: [{ type: "text", text }] });
  break;
}
```

- [ ] **Step 2: Write failing integration tests**

Append to `tests/proxy.integration.test.ts`:

```typescript
it("meters upstream calls to audit.jsonl", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ctxslim-meter-"));
  cleanup.push(dir);
  process.env.CTX_SLIM_STATS_DIR = dir;
  try {
    const configFile = makeConfigFile({ alpha: spawnEntry("alpha") });
    cleanup.push(configFile);
    const { slimServer, client } = await startProxy(configFile);
    activeServers.push(slimServer);
    await client.callTool({ name: "alpha_tool_0", arguments: { id: "x" } });
    await client.callTool({ name: "alpha_tool_0", arguments: { id: "x" } });
    await client.callTool({ name: "alpha_tool_1", arguments: { id: "x", fail: true } });
    const { loadAuditRecords } = await import("../src/config.js");
    const { hashArgs } = await import("../src/audit.js");
    const { records } = loadAuditRecords();
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({ server: "alpha", tool: "alpha_tool_0", isError: false });
    expect(records[0].argsHash).toBe(hashArgs({ id: "x" }));
    expect(records[0].outChars).toBeGreaterThan(0);
    expect(records[0].reqChars).toBe(JSON.stringify({ id: "x" }).length);
    expect(records[2]).toMatchObject({ tool: "alpha_tool_1", isError: true });
    const raw = readFileSync(join(dir, "audit.jsonl"), "utf8");
    expect(raw).not.toContain('"id":"x"');
  } finally {
    delete process.env.CTX_SLIM_STATS_DIR;
  }
});

it("writes no audit lines when stats are disabled", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ctxslim-meter-"));
  cleanup.push(dir);
  process.env.CTX_SLIM_STATS_DIR = dir;
  try {
    const configFile = makeConfigFile({ alpha: spawnEntry("alpha") });
    cleanup.push(configFile);
    const { client } = await startProxy(configFile, {}, false);
    await client.callTool({ name: "alpha_tool_0", arguments: { id: "x" } });
    expect(existsSync(join(dir, "audit.jsonl"))).toBe(false);
  } finally {
    delete process.env.CTX_SLIM_STATS_DIR;
  }
});
```

Notes for the implementer: `startProxy` returns `{ slimServer, client }` — destructure both. `readFileSync`, `existsSync`, `mkdtempSync`, `join`, `tmpdir` — check the file's existing imports and extend them (`existsSync` and `readFileSync` need adding to the `node:fs` import; verify against the current import line before editing).

- [ ] **Step 3: Run to verify failure**

Run: `node_modules/.bin/vitest run tests/proxy.integration.test.ts --no-file-parallelism < /dev/null > /tmp/opencode/test-meter-red.txt 2>&1`
Expected: FAIL — no `audit.jsonl` written (metering not implemented). The `fail: true` call returns an error result either way; the audit assertions fail.

- [ ] **Step 4: Implement the hook in server.ts**

Extend the config import (line 24):

```typescript
import { appendAuditLine, loadUsageMap, saveSessionStats, saveUsageMap } from "./config.js";
```

Add audit import after the output import (line 18):

```typescript
import { hashArgs } from "./audit.js";
```

Add the private method after `maybeSaveUsage` (after line 301):

```typescript
private recordAudit(entry: { server: string; tool: string; args: unknown; reqChars: number; outChars: number; isError: boolean; durationMs: number }): void {
  if (!this.statsEnabled) return;
  try {
    appendAuditLine({
      ts: Date.now(),
      session: this.startedAt.toISOString(),
      server: entry.server,
      tool: entry.tool,
      argsHash: hashArgs(entry.args),
      reqChars: entry.reqChars,
      outChars: entry.outChars,
      isError: entry.isError,
      durationMs: entry.durationMs,
    });
  } catch {
    return;
  }
}
```

Rewrite the try/catch in `handleCallTool` (lines 379-395):

```typescript
try {
  const callStart = Date.now();
  const reqChars = JSON.stringify(args ?? {}).length;
  const result = await upstream.callTool(resolvedTool.originalName, args);
  const maxChars = this.config.mcpServers[resolvedTool.server]?.output?.maxChars;
  const finalResult = maxChars ? compressToolResult(result, maxChars).result : result;
  this.recordAudit({
    server: resolvedTool.server,
    tool: resolvedTool.originalName,
    args,
    reqChars,
    outChars: JSON.stringify(finalResult ?? {}).length,
    isError: false,
    durationMs: Date.now() - callStart,
  });
  this.usage.set(key, {
    count: (this.usage.get(key)?.count ?? 0) + 1,
    lastUsed: Date.now(),
  });
  this.calledKeys.add(key);
  this.maybeSaveUsage();
  this.callsRouted += 1;
  return finalResult;
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const errorResult = { content: [{ type: "text", text: `Tool "${exposedName}" failed: ${message}` }], isError: true };
  this.recordAudit({
    server: resolvedTool.server,
    tool: resolvedTool.originalName,
    args,
    reqChars: JSON.stringify(args ?? {}).length,
    outChars: JSON.stringify(errorResult).length,
    isError: true,
    durationMs: 0,
  });
  return errorResult;
}
```

Note: `outChars` measures the compressed `finalResult` — the exact bytes the model receives.

- [ ] **Step 5: Run tests**

Run the integration file: `node_modules/.bin/vitest run tests/proxy.integration.test.ts --no-file-parallelism < /dev/null > /tmp/opencode/test-meter.txt 2>&1`
Expected: PASS. Then full suite detached (`> /tmp/opencode/test-t4.txt`), poll. Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/server.ts tests/fake-server.mjs tests/proxy.integration.test.ts > /tmp/opencode/git-t4.txt 2>&1
git commit -m "feat: meter upstream calls to audit.jsonl" > /tmp/opencode/git-t4.txt 2>&1
```

---

### Task 5: `ctxslim audit` CLI

**Files:**
- Modify: `src/index.ts` (usage line 22 area, Args type, parseArgs, new printAudit, dispatch in main)
- Test: `tests/cli-audit.test.ts` (create)

**Interfaces:**
- Consumes: `loadAuditRecords` from `src/config.js`, `summarizeAudit` from `src/audit.js`, `PRICE_TABLE, PRICE_AS_OF, dollarsFor, parsePricesFile` from `src/pricing.js`, `loadStatsSummary` from `src/config.js`, `estimateTokens` from `src/compressor.js`.
- Produces: `ctxslim audit [--gap N] [--model F] [--prices P] [--json]`.

Report contract (`--json` shape):

```json
{
  "summary": {
    "tasks": 2, "calls": 5, "toolOutTokens": 1234,
    "spendByFamily": { "sonnet": 0.003, "opus": 0.018 },
    "defsPerRequestTokens": 4000,
    "defsPerRequestByFamily": { "sonnet": { "full": 0.012, "cached": 0.0012 } },
    "dupWasteByFamily": { "sonnet": 0.001 },
    "errorWasteByFamily": { "sonnet": 0.0004 },
    "corrupt": 0, "pricesAsOf": "2026-09-08", "pricesEstimated": true
  },
  "tasks": [{ "id": "task-1", "session": "s", "calls": 3, "outTokens": 900, "errors": 0, "spend": { "sonnet": 0.002 } }],
  "tools": [{ "key": "alpha::alpha_tool_0", "calls": 3, "outTokens": 900, "errors": 0, "dupCalls": 2, "spend": { "sonnet": 0.002 } }],
  "waste": {
    "duplicates": [{ "key": "alpha::alpha_tool_0::<hash>", "count": 2, "wasteTokens": 100, "spend": { "sonnet": 0.0003 } }],
    "errors": [{ "key": "alpha::alpha_tool_1", "count": 1, "wasteTokens": 25, "spend": { "sonnet": 0.0001 } }]
  }
}
```

- [ ] **Step 1: Write failing tests**

Create `tests/cli-audit.test.ts` (same execFileSync+tsx pattern as `tests/cli-stats.test.ts` — read that file first for the exact harness):

```typescript
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("../src/index.ts", import.meta.url));

const seedDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "ctxslim-cliaudit-"));
  const lines = [
    { ts: 1757000000000, session: "s1", server: "alpha", tool: "t0", argsHash: "a1", reqChars: 10, outChars: 4000, isError: false, durationMs: 5 },
    { ts: 1757000001000, session: "s1", server: "alpha", tool: "t0", argsHash: "a1", reqChars: 10, outChars: 4000, isError: false, durationMs: 6 },
    { ts: 1757000002000, session: "s1", server: "beta", tool: "t9", argsHash: "b9", reqChars: 10, outChars: 400, isError: true, durationMs: 7 },
  ];
  writeFileSync(join(dir, "audit.jsonl"), lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  writeFileSync(join(dir, "stats.jsonl"), JSON.stringify({
    startedAt: "2026-09-08T00:00:00.000Z",
    endedAt: "2026-09-08T00:01:00.000Z",
    configSource: "test",
    mode: "auto",
    servers: 2,
    toolsUpstream: 10,
    tokensBefore: 9000,
    tokensAfter: 4000,
    callsRouted: 3,
  }) + "\n");
  return dir;
};

const run = (dir: string, extra: string[]): string =>
  execFileSync("npx", ["tsx", cli, "audit", ...extra], {
    env: { ...process.env, CTX_SLIM_STATS_DIR: dir },
    encoding: "utf8",
    timeout: 60000,
  });

describe("ctxslim audit CLI", () => {
  it("renders human output with headline, tasks, tools and waste", () => {
    const out = run(seedDir(), []);
    expect(out).toContain("tasks");
    expect(out).toContain("alpha::t0");
    expect(out).toContain("Duplicate");
    expect(out).toContain("sonnet");
    expect(out).toContain("indicative");
  });

  it("renders --json with the report contract", () => {
    const parsed = JSON.parse(run(seedDir(), ["--json"]));
    expect(parsed.summary.calls).toBe(3);
    expect(parsed.summary.tasks).toBe(1);
    expect(parsed.tools).toHaveLength(2);
    expect(parsed.waste.duplicates).toHaveLength(1);
    expect(parsed.waste.duplicates[0].count).toBe(2);
    expect(parsed.summary.spendByFamily.sonnet).toBeGreaterThan(0);
    expect(parsed.summary.defsPerRequestTokens).toBe(4000);
    expect(typeof parsed.summary.pricesAsOf).toBe("string");
  });

  it("reports empty state with no data", () => {
    const out = run(mkdtempSync(join(tmpdir(), "ctxslim-cliaudit-")), []);
    expect(out).toContain("No audit data");
  });

  it("rejects unknown --model and bad --gap", () => {
    const dir = seedDir();
    expect(() => run(dir, ["--model", "nope"])).toThrow();
    expect(() => run(dir, ["--gap", "0"])).toThrow();
  });
});
```

Duplicate waste check on the seed: pair outChars 8000, waste = round(8000*1/2) = 4000 chars = 1000 tokens. Error waste: 400 chars = 100 tokens.

- [ ] **Step 2: Run to verify failure**

Run: `node_modules/.bin/vitest run tests/cli-audit.test.ts --no-file-parallelism < /dev/null > /tmp/opencode/test-cliaudit-red.txt 2>&1`
Expected: FAIL — `audit` rejected as unknown argument.

- [ ] **Step 3: Implement in index.ts**

Usage text — add after the stats line:

```typescript
`    ctxslim audit [--gap <s>] [--model <fam>] [--prices <file>] [--json]`,
`                                Show per-task dollar spend (prices are estimates)`,
```

Args type — add: `gap?: number; model?: string; prices?: string;`

parseArgs — before the final else, after the `--json` branch:

```typescript
} else if (arg === "--gap") {
  const value = Number(argv[++i]);
  if (!Number.isFinite(value) || value <= 0) fail("--gap must be a positive number of seconds");
  args.gap = value;
} else if (arg === "--model") {
  const value = argv[++i];
  if (!value) fail("--model requires a family name");
  args.model = value;
} else if (arg === "--prices") {
  const value = argv[++i];
  if (!value) fail("--prices requires a path");
  args.prices = value;
} else if ...
```

Imports — extend line 2 and add new ones:

```typescript
import { loadAuditRecords, loadConfig, loadStatsSummary, loadUsageMap, describeConfig } from "./config.js";
import { summarizeAudit } from "./audit.js";
import { PRICE_AS_OF, PRICE_TABLE, dollarsFor, familyNames, parsePricesFile } from "./pricing.js";
import { estimateTokens } from "./compressor.js";
```

Check ui.js exports for a `yellow` helper (used by runInit) — reuse `bold`, `dim`, `green`, `red` for the report. Money formatting helper (local to index.ts):

```typescript
const fmtUsd = (value: number): string => (value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`);
```

printAudit implementation:

```typescript
const printAudit = (opts: { gap: number; model?: string; prices?: string; json: boolean }): void => {
  const { records, corrupt } = loadAuditRecords();
  let table = PRICE_TABLE;
  let asOf = PRICE_AS_OF;
  if (opts.prices) {
    try {
      const raw: unknown = JSON.parse(readFileSync(opts.prices, "utf8"));
      table = parsePricesFile(raw);
      asOf = "custom file";
    } catch (err) {
      process.stderr.write(`${red("prices:")} ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  }
  if (opts.model && !table.some((row) => row.family === opts.model)) {
    process.stderr.write(`${red("model:")} unknown family "${opts.model}" (known: ${familyNames(table).join(", ")})\n`);
    process.exit(1);
  }
  const headFamily = opts.model ?? "sonnet";
  if (!table.some((row) => row.family === headFamily)) {
    process.stderr.write(`${red("model:")} default family "sonnet" not in price table; pass --model explicitly\n`);
    process.exit(1);
  }
  if (records.length === 0) {
    if (opts.json) {
      process.stdout.write(`${JSON.stringify({ summary: null, tasks: [], tools: [], waste: { duplicates: [], errors: [] } }, null, 2)}\n`);
      return;
    }
    process.stdout.write(`  ${dim("No audit data yet.")}\n  ${dim("Run ctxslim with your MCP client, then re-run ctxslim audit.")}\n`);
    return;
  }
  const summary = summarizeAudit(records, opts.gap);
  const { lines } = loadStatsSummary();
  const defsTokens = lines.length > 0 ? Math.round(lines.reduce((sum, line) => sum + line.tokensAfter, 0) / lines.length) : 0;
  const spendByFamily: Record<string, number> = {};
  for (const row of table) spendByFamily[row.family] = dollarsFor(estimateTokens(summary.totalOutChars), row.inputPer1M);
  const defsByFamily: Record<string, { full: number; cached: number }> = {};
  for (const row of table) {
    defsByFamily[row.family] = {
      full: dollarsFor(defsTokens, row.inputPer1M),
      cached: dollarsFor(defsTokens, row.cacheReadPer1M ?? row.inputPer1M),
    };
  }
  const wasteSpend = (chars: number): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const row of table) out[row.family] = dollarsFor(estimateTokens(chars), row.inputPer1M);
    return out;
  };
  ...
};
```

`readFileSync` must be imported from `node:fs` in index.ts (currently not imported — add `import { readFileSync } from "node:fs";`).

Human rendering (append after the computed values):

```typescript
if (opts.json) {
  const tasks = summary.tasks.map((task) => ({
    id: task.id,
    session: task.session,
    calls: task.calls,
    outTokens: estimateTokens(task.outChars),
    errors: task.errors,
    spend: Object.fromEntries(table.map((row) => [row.family, dollarsFor(estimateTokens(task.outChars), row.inputPer1M)])),
  }));
  const tools = summary.tools.map((row) => ({
    key: row.key,
    calls: row.calls,
    outTokens: estimateTokens(row.outChars),
    errors: row.errors,
    dupCalls: row.dupCalls,
    spend: Object.fromEntries(table.map((family) => [family.family, dollarsFor(estimateTokens(row.outChars), family.inputPer1M)])),
  }));
  const duplicates: { key: string; count: number; wasteTokens: number; spend: Record<string, number> }[] = [];
  const errors: { key: string; count: number; wasteTokens: number; spend: Record<string, number> }[] = [];
  for (const task of summary.tasks) {
    for (const dup of task.dups) duplicates.push({ key: dup.key, count: dup.count, wasteTokens: estimateTokens(dup.wasteChars), spend: wasteSpend(dup.wasteChars) });
  }
  const byError = new Map<string, { count: number; outChars: number }>();
  for (const record of records) {
    if (!record.isError) continue;
    const key = `${record.server}::${record.tool}`;
    const entry = byError.get(key) ?? { count: 0, outChars: 0 };
    entry.count += 1;
    entry.outChars += record.outChars;
    byError.set(key, entry);
  }
  for (const [key, entry] of byError) errors.push({ key, count: entry.count, wasteTokens: estimateTokens(entry.outChars), spend: wasteSpend(entry.outChars) });
  process.stdout.write(
    `${JSON.stringify(
      {
        summary: {
          tasks: summary.tasks.length,
          calls: summary.totalCalls,
          toolOutTokens: estimateTokens(summary.totalOutChars),
          spendByFamily,
          defsPerRequestTokens: defsTokens,
          defsPerRequestByFamily: defsByFamily,
          dupWasteByFamily: wasteSpend(summary.dupWasteChars),
          errorWasteByFamily: wasteSpend(summary.errorWasteChars),
          corrupt,
          pricesAsOf: asOf,
          pricesEstimated: true,
        },
        tasks,
        tools,
        waste: { duplicates, errors },
      },
      null,
      2
    )}\n`
  );
  return;
}
const out: string[] = [
  "",
  `  ${bold("CtxSlim")} ${dim("— spend audit")}  ${dim(`(prices indicative as of ${asOf})`)}`,
  "",
  `  tasks               ${summary.tasks.length}`,
  `  tool calls          ${summary.totalCalls}`,
  `  tool-output spend   ${table.map((row) => `${row.family} ${fmtUsd(spendByFamily[row.family] ?? 0)}`).join("  ")}`,
  `  definitions/request ~${fmtTokens(defsTokens)} tokens  ${table.map((row) => `${row.family} ${fmtUsd(defsByFamily[row.family]?.full ?? 0)}/${fmtUsd(defsByFamily[row.family]?.cached ?? 0)}`).join("  ")} ${dim("(full/cached)")}`,
  `  duplicate waste     ${fmtUsd(wasteSpend(summary.dupWasteChars)[headFamily] ?? 0)} ${dim(`(${headFamily})`)}`,
  `  error waste         ${fmtUsd(wasteSpend(summary.errorWasteChars)[headFamily] ?? 0)} ${dim(`(${headFamily})`)}`,
  "",
  `  ${bold(`Top tasks (${headFamily})`)}`,
];
for (const task of summary.tasks.slice(0, 10)) {
  const dominant = Object.entries(task.byServer).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "-";
  out.push(`    ${task.id.padEnd(8)} ${String(task.calls).padStart(4)} calls  ${fmtUsd(dollarsFor(estimateTokens(task.outChars), table.find((row) => row.family === headFamily)?.inputPer1M ?? 0))}  ${dim(dominant)}`);
}
out.push("", `  ${bold(`Top tools (${headFamily})`)}`);
for (const row of summary.tools.slice(0, 10)) {
  const rate = table.find((entry) => entry.family === headFamily)?.inputPer1M ?? 0;
  out.push(`    ${String(row.calls).padStart(4)}×  ${fmtUsd(dollarsFor(estimateTokens(row.outChars), rate))}  ${row.key}${row.errors > 0 ? `  ${red(`${row.errors} err`)}` : ""}`);
}
const dupGroups = summary.tasks.flatMap((task) => task.dups).sort((a, b) => b.wasteChars - a.wasteChars).slice(0, 10);
if (dupGroups.length > 0) {
  out.push("", `  ${bold("Duplicate calls (paid N× for identical args)")}`);
  for (const dup of dupGroups) {
    out.push(`    ${String(dup.count).padStart(4)}×  ${fmtUsd(dollarsFor(estimateTokens(dup.wasteChars), table.find((entry) => entry.family === headFamily)?.inputPer1M ?? 0))} waste  ${dup.server}::${dup.tool}`);
  }
}
out.push("", `  ${dim("Model tokens excluded — MCP-attributable spend only. Tune with --gap, --model, --prices.")}`, "");
process.stdout.write(out.join("\n"));
```

`fmtTokens` and `red` are already imported in index.ts (used by `printStats`).

Dispatch in main:

```typescript
if (args.command === "audit") {
  printAudit({ gap: args.gap ?? 120, model: args.model, prices: args.prices, json: args.json === true });
  return;
}
```

Place after the stats dispatch.

- [ ] **Step 4: Run tests**

Run: `node_modules/.bin/vitest run tests/cli-audit.test.ts --no-file-parallelism < /dev/null > /tmp/opencode/test-cliaudit.txt 2>&1`
Expected: PASS (4/4). Then full suite detached (`> /tmp/opencode/test-t5.txt`), poll. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/cli-audit.test.ts > /tmp/opencode/git-t5.txt 2>&1
git commit -m "feat: ctxslim audit CLI with per-task dollar spend" > /tmp/opencode/git-t5.txt 2>&1
```

---

### Task 6: Version bump, README, verify, release

**Files:**
- Modify: `package.json` (0.4.0), `src/server.ts` (2 version strings), `src/upstream.ts` (client version), `src/index.ts` (--version), `README.md` (audit docs)

- [ ] **Step 1: Bump version strings**

- `package.json`: `"version": "0.4.0"`
- `src/server.ts`: `version: "0.4.0"` in `new Server(...)`; `dim("v0.4.0")` in `printBanner`
- `src/upstream.ts`: `new Client({ name: "ctxslim", version: "0.4.0" })`
- `src/index.ts`: `"0.4.0\n"` in the `--version` branch

- [ ] **Step 2: Update README**

- New `ctxslim audit` section: what it measures, example output sketch, flags (`--gap`, `--model`, `--prices`, `--json`), the two pricing rules (tool outputs priced as input; definitions full + cached), "prices indicative as of 2026-09-08, override with --prices".
- Privacy section: add `audit.jsonl` alongside `stats.jsonl`/`usage.json` — local-only, sizes + hashes only, disabled by `--no-stats`.

- [ ] **Step 3: Typecheck + build + full suite**

```bash
npx tsc --noEmit > /tmp/opencode/tsc-04.txt 2>&1
npm run build > /tmp/opencode/build-04.txt 2>&1
```

Then full suite DETACHED: `nohup node_modules/.bin/vitest run --no-file-parallelism < /dev/null > /tmp/opencode/test-t6.txt 2>&1 &`, poll for the `Tests` summary.
Expected: clean typecheck, clean build, all tests pass (~100).

- [ ] **Step 4: Smoke test**

```bash
node dist/index.js audit --json > /tmp/opencode/audit-smoke.txt 2>&1
```

Expected: valid JSON (likely the empty `{ summary: null, ... }` shape against the real `~/.ctxslim`, or real data if sessions accumulated — either is a pass as long as exit 0 and JSON parses). Verify with `node -e "JSON.parse(require('fs').readFileSync('/tmp/opencode/audit-smoke.txt','utf8')); console.log('json ok')"`.

- [ ] **Step 5: Commit, push, publish**

```bash
git add -A > /tmp/opencode/git-04.txt 2>&1
```

Do NOT sweep in unrelated untracked files — if `git status` shows anything outside this plan's files (e.g. `promo/`), stage explicitly instead: `git add package.json src/server.ts src/upstream.ts src/index.ts README.md`.

```bash
git commit -m "chore: release v0.4.0 — ctxslim audit with per-task dollar spend" > /tmp/opencode/git-04.txt 2>&1
git push origin main > /tmp/opencode/git-04.txt 2>&1
npm publish > /tmp/opencode/npm-04.txt 2>&1
git ls-remote origin main > /tmp/opencode/lsremote-04.txt 2>&1
npm view ctxslim version > /tmp/opencode/npmview-04.txt 2>&1
```

Verify: ls-remote matches local HEAD; npm view shows 0.4.0 (allow ~1 min replication lag, retry the view once). If publish fails on sandbox network after one retry: push anyway, report publish BLOCKED with the exact error.
