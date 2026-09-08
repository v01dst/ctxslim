import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("../src/index.ts", import.meta.url));

describe("ctxslim stats CLI", () => {
  it("renders human output with sessions and top tools", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctxslim-clistats-"));
    writeFileSync(join(dir, "stats.jsonl"), JSON.stringify({
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      configSource: "test",
      mode: "auto",
      servers: 1,
      toolsUpstream: 10,
      tokensBefore: 9000,
      tokensAfter: 3000,
      callsRouted: 4,
    }) + "\n");
    writeFileSync(join(dir, "usage.json"), JSON.stringify({ "alpha::tool_0": { count: 7, lastUsed: Date.now() } }));
    const out = execFileSync("npx", ["tsx", cli, "stats"], {
      env: { ...process.env, CTX_SLIM_STATS_DIR: dir },
      encoding: "utf8",
      timeout: 60000,
    });
    expect(out).toContain("sessions recorded");
    expect(out).toContain("alpha::tool_0");
  });

  it("renders --json output", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctxslim-clistats-"));
    const out = execFileSync("npx", ["tsx", cli, "stats", "--json"], {
      env: { ...process.env, CTX_SLIM_STATS_DIR: dir },
      encoding: "utf8",
      timeout: 60000,
    });
    const parsed = JSON.parse(out);
    expect(parsed.summary.sessions).toBe(0);
    expect(Array.isArray(parsed.byTool)).toBe(true);
  });
});
