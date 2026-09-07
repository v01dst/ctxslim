import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadUsageMap, saveUsageMap } from "../src/config.js";

describe("usage persistence", () => {
  it("round-trips a usage map", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctxslim-usage-"));
    process.env.CTX_SLIM_STATS_DIR = dir;
    saveUsageMap({ "alpha::tool_0": { count: 3, lastUsed: 12345 } });
    const loaded = loadUsageMap();
    expect(loaded["alpha::tool_0"]).toEqual({ count: 3, lastUsed: 12345 });
  });

  it("returns empty map when no file exists", () => {
    process.env.CTX_SLIM_STATS_DIR = join(mkdtempSync(join(tmpdir(), "ctxslim-usage-")), "missing-dir");
    expect(loadUsageMap()).toEqual({});
  });

  it("survives corrupt json", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctxslim-usage-"));
    process.env.CTX_SLIM_STATS_DIR = dir;
    writeFileSync(join(dir, "usage.json"), "{not json");
    expect(loadUsageMap()).toEqual({});
  });
});
