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
    if (!first) return;
    const last = current[current.length - 1];
    if (!last) return;
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
      endTs: last.ts,
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
