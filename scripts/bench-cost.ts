import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tokensForChars } from "../src/compressor.js";
import { PRICE_TABLE, dollarsFor } from "../src/pricing.js";
import { ContextSlimServer } from "../src/server.js";
import type { ServerEntry } from "../src/types.js";

const fakeServer = fileURLToPath(new URL("../tests/fake-server.mjs", import.meta.url));

const entry = (name: string, count: number): ServerEntry => ({ command: process.execPath, args: [fakeServer, name, String(count)] });

const scenarios = [
  { name: "2 servers x 8 tools", servers: { files: entry("files", 8), database: entry("database", 8) } },
  { name: "4 servers x 10 tools", servers: { files: entry("files", 10), database: entry("database", 10), github: entry("github", 10), browser: entry("browser", 10) } },
  { name: "6 servers x 12 tools", servers: { files: entry("files", 12), database: entry("database", 12), github: entry("github", 12), browser: entry("browser", 12), slack: entry("slack", 12), stripe: entry("stripe", 12) } },
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

const boot = async (servers: Record<string, ServerEntry>, slim: Record<string, unknown>) => {
  const proxy = new ContextSlimServer({ mcpServers: servers, slim: slim as never }, { stats: false, quiet: true });
  const client = new Client({ name: "costbench", version: "0.0.0" });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await Promise.all([proxy.start(serverT), client.connect(clientT)]);
  await waitReady(proxy);
  return { proxy, client };
};

const close = async (proxy: ContextSlimServer, client: Client): Promise<void> => {
  await proxy.stop();
  await client.close();
};

const usd = (tokens: number): Record<string, number> =>
  Object.fromEntries(PRICE_TABLE.map((row) => [row.family, Number(dollarsFor(tokens, row.inputPer1M).toFixed(6))]));

const rows: Record<string, unknown>[] = [];

for (const scenario of scenarios) {
  const full = await boot(scenario.servers, { maxTools: 9999, mode: "auto" });
  await full.client.listTools();
  const base = full.proxy.sessionSummary;
  const bigName = `${Object.keys(scenario.servers)[0]}_tool_0__big`;
  const bigRaw = (await full.client.callTool({ name: bigName, arguments: {} })) as { content: { text: string }[] };
  const rawChars = JSON.stringify(bigRaw).length;
  await close(full.proxy, full.client);

  const slimmed = await boot(scenario.servers, { maxTools: 24, mode: "auto" });
  await slimmed.client.listTools();
  const slim = slimmed.proxy.sessionSummary;
  await close(slimmed.proxy, slimmed.client);

  const cappedServers: Record<string, ServerEntry> = Object.fromEntries(
    Object.entries(scenario.servers).map(([name, e]) => [name, { ...e, output: { maxChars: 4000 } }])
  );
  const capped = await boot(cappedServers, { maxTools: 9999, mode: "auto" });
  const bigCut = (await capped.client.callTool({ name: bigName, arguments: {} })) as { content: { text: string }[] };
  const cutChars = JSON.stringify(bigCut).length;
  await close(capped.proxy, capped.client);

  const tokensBefore = Math.round(base.tokensBefore);
  const tokensAfter = Math.round(slim.tokensAfter);
  const rawTokens = tokensForChars(rawChars);
  const cutTokens = tokensForChars(cutChars);
  rows.push({
    scenario: scenario.name,
    tokensPerRequestBefore: tokensBefore,
    tokensPerRequestAfter: tokensAfter,
    savingsPct: Number((((tokensBefore - tokensAfter) / tokensBefore) * 100).toFixed(1)),
    usdPerRequestBefore: usd(tokensBefore),
    usdPerRequestAfter: usd(tokensAfter),
    bigCallTokensRaw: rawTokens,
    bigCallTokensCapped: cutTokens,
    usdPerBigCallRaw: usd(rawTokens),
    usdPerBigCallCapped: usd(cutTokens),
  });
  console.log(`done ${scenario.name}: ${tokensBefore} -> ${tokensAfter} tokens/request`);
}

writeFileSync("bench-cost-results.json", JSON.stringify(rows, null, 2));
console.log("wrote bench-cost-results.json");
