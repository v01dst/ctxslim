import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ContextSlimServer } from "../src/server.js";
import { compressTool } from "../src/compressor.js";
import type { ToolDefinition } from "../src/types.js";

const fakeServer = fileURLToPath(new URL("../tests/fake-server.mjs", import.meta.url));

const entry = (name: string, count: number) => ({ command: process.execPath, args: [fakeServer, name, String(count)] });

const scenarios = [
  { name: "2 servers × 8 tools", servers: { files: entry("files", 8), database: entry("database", 8) } },
  { name: "4 servers × 10 tools", servers: { files: entry("files", 10), database: entry("database", 10), github: entry("github", 10), browser: entry("browser", 10) } },
  { name: "6 servers × 12 tools", servers: { files: entry("files", 12), database: entry("database", 12), github: entry("github", 12), browser: entry("browser", 12), slack: entry("slack", 12), stripe: entry("stripe", 12) } },
];

const waitReady = async (slim: ContextSlimServer): Promise<void> => {
  const start = Date.now();
  for (;;) {
    const statuses = slim.upstreamStatuses;
    if (statuses.length > 0 && statuses.every((s) => s.status === "ready" || s.status === "error")) {
      const bad = statuses.filter((s) => s.status !== "ready").map((s) => s.name);
      if (bad.length > 0) throw new Error(`upstreams failed: ${bad.join(",")}`);
      return;
    }
    if (Date.now() - start > 90000) throw new Error("upstream boot timeout");
    await new Promise((r) => setTimeout(r, 250));
  }
};

const run = async (scenario: (typeof scenarios)[number], maxTools: number) => {
  const slim = new ContextSlimServer(
    { mcpServers: scenario.servers, slim: { maxTools, mode: "auto", descriptionBudget: 280 } },
    { stats: false, quiet: true }
  );
  const client = new Client({ name: "bench", version: "0.0.0" });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await Promise.all([slim.start(serverT), client.connect(clientT)]);
  await waitReady(slim);
  await client.listTools();
  const summary = slim.sessionSummary;
  await slim.stop();
  await client.close();
  return summary;
};

const results: Record<string, unknown>[] = [];
const tool = (n: number): ToolDefinition => JSON.parse(`{"name":"tool_${n}"}`) as ToolDefinition;

for (const scenario of scenarios) {
  const before = await run(scenario, 9999);
  const slimmed = await run(scenario, 24);
  results.push({
    scenario: scenario.name,
    servers: Object.keys(scenario.servers).length,
    toolsUpstream: before.tokensBefore === 0 ? 0 : undefined,
    tokensBefore: Math.round(before.tokensBefore),
    tokensAfterFullProxy: Math.round(before.tokensAfter),
    tokensAfterTop24: Math.round(slimmed.tokensAfter),
    savingsFullPct: Number((((before.tokensBefore - before.tokensAfter) / before.tokensBefore) * 100).toFixed(1)),
    savingsTop24Pct: Number((((before.tokensBefore - slimmed.tokensAfter) / before.tokensBefore) * 100).toFixed(1)),
  });
}

void tool;
writeFileSync("bench-results.json", JSON.stringify(results, null, 2));
console.table(results);
void compressTool;
