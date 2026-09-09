import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("../src/index.ts", import.meta.url));

const T0 = 1757000000000;

const seedDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "ctxslim-clitune-"));
  writeFileSync(join(dir, "usage.json"), JSON.stringify({ "alpha::pinned_tool": { count: 9, lastUsed: T0 } }));
  writeFileSync(
    join(dir, "stats.jsonl"),
    JSON.stringify({
      startedAt: "2026-09-08T00:00:00.000Z",
      endedAt: "2026-09-08T00:01:00.000Z",
      configSource: "test",
      mode: "auto",
      servers: 2,
      toolsUpstream: 10,
      tokensBefore: 12000,
      tokensAfter: 8000,
      callsRouted: 12,
    }) + "\n"
  );
  const audit = [
    ...Array.from({ length: 9 }, (_, i) => ({ ts: T0 + i * 1000, session: "s1", server: "alpha", tool: "pinned_tool", argsHash: `h${i}`, reqChars: 10, outChars: 100, isError: false, durationMs: 5 })),
    { ts: T0 + 9000, session: "s1", server: "alpha", tool: "big_tool", argsHash: "b0", reqChars: 10, outChars: 40000, isError: false, durationMs: 5 },
    { ts: T0 + 10000, session: "s1", server: "alpha", tool: "big_tool", argsHash: "b1", reqChars: 10, outChars: 40000, isError: false, durationMs: 5 },
    { ts: T0 + 11000, session: "s1", server: "alpha", tool: "big_tool", argsHash: "b2", reqChars: 10, outChars: 40000, isError: false, durationMs: 5 },
  ];
  writeFileSync(join(dir, "audit.jsonl"), audit.map((line) => JSON.stringify(line)).join("\n") + "\n");
  writeFileSync(join(dir, "ctxslim.json"), JSON.stringify({ mcpServers: { alpha: { command: "node" }, idle: { command: "node" } } }));
  return dir;
};

const run = (dir: string, extra: string[], cwd?: string): string =>
  execFileSync("npx", ["tsx", cli, "doctor", ...extra], {
    env: { ...process.env, CTX_SLIM_STATS_DIR: dir },
    cwd: cwd ?? dir,
    encoding: "utf8",
    timeout: 60000,
  });

describe("ctxslim doctor --tune", () => {
  it("suggests pins, lower maxTools, output caps, exclusion and disclosure", () => {
    const out = run(seedDir(), ["--tune"]);
    expect(out).toContain("alpha::pinned_tool");
    expect(out).toContain("maxTools");
    expect(out).toContain("idle");
    expect(out).toContain("output.maxChars");
    expect(out).toContain("disclosure");
  });

  it("emits the --json contract", () => {
    const parsed = JSON.parse(run(seedDir(), ["--tune", "--json"]));
    expect(parsed.pins).toContain("alpha::pinned_tool");
    expect(typeof parsed.maxTools).toBe("number");
    expect(parsed.maxTools).toBeLessThan(24);
    expect(parsed.considerExclude).toContain("idle");
    expect(parsed.outputCaps).toEqual([{ server: "alpha", maxChars: 4000 }]);
    expect(parsed.enableDisclosure).toBe(true);
    expect(Array.isArray(parsed.notes)).toBe(true);
  });

  it("handles empty data without crashing", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctxslim-clitune-"));
    writeFileSync(join(dir, "ctxslim.json"), JSON.stringify({ mcpServers: { alpha: { command: "node" } } }));
    const out = run(dir, ["--tune"]);
    expect(out).toContain("no data");
    const parsed = JSON.parse(run(dir, ["--tune", "--json"]));
    expect(parsed.pins).toEqual([]);
    expect(parsed.maxTools).toBeNull();
  });
});
