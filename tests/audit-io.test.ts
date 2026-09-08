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
