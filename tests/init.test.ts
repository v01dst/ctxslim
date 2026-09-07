import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyInit, planInit, resolveTarget } from "../src/init.js";

const cleanup: string[] = [];

const makeConfig = (body: unknown): string => {
  const dir = mkdtempSync(join(tmpdir(), "ctxslim-init-"));
  cleanup.push(dir);
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(body, null, 2));
  return path;
};

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("resolveTarget", () => {
  it("maps known client labels", () => {
    expect(resolveTarget("cursor")?.path).toContain(".cursor");
    expect(resolveTarget("claude-desktop")?.path).toContain("claude_desktop_config.json");
  });

  it("treats unknown values as file paths", () => {
    expect(resolveTarget("/tmp/my-mcp.json")?.path).toBe("/tmp/my-mcp.json");
  });
});

describe("applyInit", () => {
  it("adds the ctxslim entry and preserves servers", () => {
    const path = makeConfig({ mcpServers: { github: { command: "npx" }, postgres: { command: "npx" } } });
    const result = applyInit({ path, label: "test", serversKey: null });
    expect(result.ok).toBe(true);
    const raw = JSON.parse(readFileSync(path, "utf8"));
    expect(Object.keys(raw.mcpServers)).toEqual(["github", "postgres", "ctxslim"]);
    expect(raw.mcpServers.ctxslim).toEqual({ command: "npx", args: ["-y", "ctxslim"] });
  });

  it("writes a backup before modifying", () => {
    const path = makeConfig({ mcpServers: { a: { command: "npx" } } });
    const result = applyInit({ path, label: "test", serversKey: null });
    expect(result.ok).toBe(true);
    expect(result.backupPath).toBeDefined();
    expect(existsSync(result.backupPath ?? "")).toBe(true);
    const backup = JSON.parse(readFileSync(result.backupPath ?? "", "utf8"));
    expect(backup.mcpServers.a).toBeDefined();
    expect(backup.mcpServers.ctxslim).toBeUndefined();
  });

  it("is idempotent — no duplicate entries", () => {
    const path = makeConfig({ mcpServers: { ctxslim: { command: "npx", args: ["-y", "ctxslim"] } } });
    const result = applyInit({ path, label: "test", serversKey: null });
    expect(result.ok).toBe(true);
    const raw = JSON.parse(readFileSync(path, "utf8"));
    expect(Object.keys(raw.mcpServers)).toEqual(["ctxslim"]);
  });

  it("replaces legacy context-slim entries", () => {
    const path = makeConfig({ mcpServers: { "context-slim": { command: "npx", args: ["-y", "context-slim"] } } });
    const result = applyInit({ path, label: "test", serversKey: null });
    const raw = JSON.parse(readFileSync(path, "utf8"));
    expect(raw.mcpServers["context-slim"]).toBeUndefined();
    expect(raw.mcpServers.ctxslim).toBeDefined();
  });

  it("handles vscode's nested servers key", () => {
    const path = makeConfig({ servers: { a: { command: "npx" } } });
    const result = applyInit({ path, label: "test", serversKey: "servers" });
    const raw = JSON.parse(readFileSync(path, "utf8"));
    expect(raw.servers.ctxslim).toBeDefined();
    expect(raw.mcpServers).toBeUndefined();
  });

  it("creates the servers key in an empty file", () => {
    const path = makeConfig({});
    const result = applyInit({ path, label: "test", serversKey: null });
    expect(result.ok).toBe(true);
    const raw = JSON.parse(readFileSync(path, "utf8"));
    expect(raw.mcpServers.ctxslim).toBeDefined();
  });

  it("refuses to touch invalid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctxslim-init-"));
    cleanup.push(dir);
    const path = join(dir, "broken.json");
    writeFileSync(path, "{not json");
    const result = applyInit({ path, label: "test", serversKey: null });
    expect(result.ok).toBe(false);
    expect(readFileSync(path, "utf8")).toBe("{not json");
  });
});

describe("planInit", () => {
  it("detects an existing installation", () => {
    const path = makeConfig({ mcpServers: { ctxslim: { command: "npx" } } });
    expect(planInit({ path, label: "test", serversKey: null }).alreadyInstalled).toBe(true);
  });

  it("reports server counts", () => {
    const path = makeConfig({ mcpServers: { a: { command: "npx" }, b: { command: "npx" } } });
    expect(planInit({ path, label: "test", serversKey: null }).serverCount).toBe(2);
  });
});
