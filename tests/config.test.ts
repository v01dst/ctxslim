import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, normalizeConfig, saveSessionStats, loadStatsSummary } from "../src/config.js";

describe("normalizeConfig", () => {
  it("accepts valid config", () => {
    const config = normalizeConfig(
      { mcpServers: { db: { command: "npx", args: ["-y", "server-db"] }, web: { url: "https://example.com/mcp" } } },
      "test"
    );
    expect(Object.keys(config.mcpServers)).toEqual(["db", "web"]);
  });

  it("rejects missing mcpServers", () => {
    expect(() => normalizeConfig({}, "test")).toThrow(/mcpServers/);
  });

  it("rejects entries with neither command nor url", () => {
    expect(() => normalizeConfig({ mcpServers: { bad: { foo: 1 } } }, "test")).toThrow(/neither/);
  });

  it("skips nested context-slim entries to avoid proxies of proxies", () => {
    const config = normalizeConfig(
      { mcpServers: { slim: { command: "npx", args: ["context-slim"] }, ok: { command: "node", args: ["x.js"] } } },
      "test"
    );
    expect(Object.keys(config.mcpServers)).toEqual(["ok"]);
  });

  it("rejects invalid mode", () => {
    expect(() => normalizeConfig({ mcpServers: { ok: { command: "node" } }, slim: { mode: "turbo" } }, "test")).toThrow(/mode/);
  });
});

describe("loadConfig", () => {
  const cleanup: string[] = [];

  afterEach(() => {
    for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("loads from explicit file", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctxslim-"));
    cleanup.push(dir);
    const path = join(dir, "cfg.json");
    writeFileSync(path, JSON.stringify({ mcpServers: { a: { command: "node", args: ["a.js"] } } }));
    const loaded = loadConfig(path);
    expect(loaded.config.mcpServers.a).toEqual({ command: "node", args: ["a.js"] });
  });

  it("loads context-slim.json from cwd", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctxslim-"));
    cleanup.push(dir);
    writeFileSync(join(dir, "context-slim.json"), JSON.stringify({ mcpServers: { a: { command: "node" } } }));
    const loaded = loadConfig(undefined, dir);
    expect(loaded.label).toBe("context-slim.json");
  });

  it("fails with actionable error when nothing found", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctxslim-"));
    cleanup.push(dir);
    expect(() => loadConfig(undefined, dir)).toThrow(/No MCP config found/);
  });

  it("explains missing explicit file", () => {
    expect(() => loadConfig("/nonexistent/cfg.json")).toThrow(/not found/);
  });
});

describe("session stats", () => {
  const cleanup: string[] = [];

  afterEach(() => {
    for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips stats to disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctxslim-stats-"));
    cleanup.push(dir);
    process.env.CTX_SLIM_STATS_DIR = dir;
    saveSessionStats({
      startedAt: "2026-09-07T00:00:00Z",
      endedAt: "2026-09-07T01:00:00Z",
      configSource: "test",
      mode: "auto",
      servers: 2,
      toolsUpstream: 40,
      tokensBefore: 10000,
      tokensAfter: 3000,
      callsRouted: 5,
    });
    const { summary } = loadStatsSummary();
    expect(summary.sessions).toBe(1);
    expect(summary.totalCalls).toBe(5);
    expect(summary.avgSavingsPct).toBeCloseTo(70, 0);
    delete process.env.CTX_SLIM_STATS_DIR;
  });
});
