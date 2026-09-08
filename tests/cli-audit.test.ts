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
