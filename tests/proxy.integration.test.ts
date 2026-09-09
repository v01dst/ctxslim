import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ContextSlimServer } from "../src/server.js";
import { loadStatsSummary } from "../src/config.js";

const fakeServer = fileURLToPath(new URL("./fake-server.mjs", import.meta.url));

const makeConfigFile = (servers: Record<string, { command: string; args: string[]; include?: string[]; exclude?: string[]; output?: { maxChars?: number } }>): string => {
  const dir = mkdtempSync(join(tmpdir(), "ctxslim-it-"));
  const path = join(dir, "ctxslim.json");
  writeFileSync(path, JSON.stringify({ mcpServers: servers }));
  return path;
};

const META_TOOL_NAMES = new Set(["search_tools", "enable_tools", "describe_tools", "list_servers", "slim_stats"]);

const waitForReady = async (client: Client, slimServer: ContextSlimServer): Promise<void> => {
  await vi.waitFor(
    async () => {
      const statuses = slimServer.upstreamStatuses;
      const settled = statuses.length > 0 && statuses.every((s) => s.status === "ready" || s.status === "error");
      expect(settled).toBe(true);
      const { tools } = await client.listTools();
      expect(tools.some((tool) => !META_TOOL_NAMES.has(tool.name))).toBe(true);
    },
    { timeout: 15000, interval: 250 }
  );
};

const startProxy = async (configFile: string, slim: Record<string, unknown> = {}, stats = false) => {
  const raw = JSON.parse(await (await import("node:fs/promises")).readFile(configFile, "utf8"));
  const slimServer = new ContextSlimServer({ ...raw, slim: { ...raw.slim, ...slim } }, { stats });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([slimServer.start(serverTransport), client.connect(clientTransport)]);
  await waitForReady(client, slimServer);
  return { slimServer, client };
};

const cleanup: string[] = [];
const activeServers: ContextSlimServer[] = [];

afterAll(async () => {
  await Promise.allSettled(activeServers.map((server) => server.stop()));
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const spawnEntry = (name: string, toolCount = 6) => ({
  command: process.execPath,
  args: [fakeServer, name, String(toolCount)],
});

describe("proxy integration", () => {
  it("aggregates servers, filters nothing below maxTools, exposes meta tools", async () => {
    const configFile = makeConfigFile({ alpha: spawnEntry("alpha"), beta: spawnEntry("beta") });
    cleanup.push(configFile);
    const { slimServer, client } = await startProxy(configFile);
    activeServers.push(slimServer);

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("alpha_tool_0");
    expect(names).toContain("beta_tool_5");
    expect(names).toContain("search_tools");
    expect(names).toContain("enable_tools");
    expect(names).toContain("list_servers");
    expect(names).toContain("slim_stats");
    expect(tools).toHaveLength(19);
  });

  it("compresses exposed schemas", async () => {
    const configFile = makeConfigFile({ alpha: spawnEntry("alpha") });
    cleanup.push(configFile);
    const { slimServer, client } = await startProxy(configFile);
    activeServers.push(slimServer);

    const { tools } = await client.listTools();
    const first = tools.find((tool) => tool.name === "alpha_tool_0");
    expect(first).toBeDefined();
    const schema = first?.inputSchema as Record<string, unknown>;
    expect(schema.$schema).toBeUndefined();
    expect(schema.title).toBeUndefined();
    expect(Object.keys((schema.$defs as Record<string, unknown>) ?? {})).toEqual(["Record"]);    expect(schema.required).toEqual(["id"]);
    const description = first?.description ?? "";
    expect(description.length).toBeLessThan(400);
  });

  it("routes tool calls to the right upstream server", async () => {
    const configFile = makeConfigFile({ alpha: spawnEntry("alpha"), beta: spawnEntry("beta") });
    cleanup.push(configFile);
    const { slimServer, client } = await startProxy(configFile);
    activeServers.push(slimServer);

    const alphaResult = await client.callTool({ name: "alpha_tool_1", arguments: { id: "x" } });
    expect(JSON.stringify(alphaResult)).toContain("alpha handled alpha_tool_1");
    const betaResult = await client.callTool({ name: "beta_tool_2", arguments: { id: "y" } });
    expect(JSON.stringify(betaResult)).toContain("beta handled beta_tool_2");
  });

  it("prefixes colliding tool names", async () => {
    const configFile = makeConfigFile({ one: spawnEntry("same"), two: spawnEntry("same") });
    cleanup.push(configFile);
    const { slimServer, client } = await startProxy(configFile);
    activeServers.push(slimServer);

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("one__same_tool_0");
    expect(names).toContain("two__same_tool_0");
    const result = await client.callTool({ name: "two__same_tool_3", arguments: { id: "z" } });
    expect(JSON.stringify(result)).toContain("same handled same_tool_3");
  });

  it("search_tools finds and ranks matching tools", async () => {
    const configFile = makeConfigFile({ alpha: spawnEntry("alpha", 10) });
    cleanup.push(configFile);
    const { slimServer, client } = await startProxy(configFile);
    activeServers.push(slimServer);

    const result = await client.callTool({ name: "search_tools", arguments: { query: "audit observability" } });
    const text = JSON.stringify(result);
    expect(text).toContain("Found");
    expect(text).toContain("alpha_tool_");
    expect(text).toContain("arguments:");
  });

  it("enable_tools pins tools for the session", async () => {
    const configFile = makeConfigFile({ alpha: spawnEntry("alpha"), beta: spawnEntry("beta"), gamma: spawnEntry("gamma"), delta: spawnEntry("delta") });
    cleanup.push(configFile);
    const { slimServer, client } = await startProxy(configFile, { maxTools: 10 });
    activeServers.push(slimServer);

    const before = await client.listTools();
    expect(before.tools).toHaveLength(15);

    await client.callTool({ name: "enable_tools", arguments: { tools: ["beta_tool_0", "gamma_tool_1"] } });
    const after = await client.listTools();
    const names = after.tools.map((tool) => tool.name);
    expect(names).toContain("beta_tool_0");
    expect(names).toContain("gamma_tool_1");
  });

  it("respects maxTools in auto mode", async () => {
    const configFile = makeConfigFile({ alpha: spawnEntry("alpha", 20), beta: spawnEntry("beta", 20) });
    cleanup.push(configFile);
    const { slimServer, client } = await startProxy(configFile, { maxTools: 5 });
    activeServers.push(slimServer);

    const { tools } = await client.listTools();
    const nonMeta = tools.filter((tool) => !["search_tools", "enable_tools", "describe_tools", "list_servers", "slim_stats"].includes(tool.name));
    expect(nonMeta).toHaveLength(5);
  });

  it("off mode passes everything through uncompressed", async () => {
    const configFile = makeConfigFile({ alpha: spawnEntry("alpha") });
    cleanup.push(configFile);
    const { slimServer, client } = await startProxy(configFile, { mode: "off" });
    activeServers.push(slimServer);

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(7);
    const first = tools[0];
    const schema = first?.inputSchema as Record<string, unknown>;
    expect(schema.$schema).toBeDefined();
    expect(schema.title).toBeDefined();
    expect((first?.description ?? "").length).toBeGreaterThan(400);
  });

  it("manual mode only exposes allowlisted servers", async () => {
    const configFile = makeConfigFile({ alpha: spawnEntry("alpha"), beta: spawnEntry("beta") });
    cleanup.push(configFile);
    const { slimServer, client } = await startProxy(configFile, { mode: "manual", allowlist: ["beta"] });
    activeServers.push(slimServer);

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("beta_tool_0");
    expect(names).not.toContain("alpha_tool_0");
  });

  it("list_servers reports connection status", async () => {
    const configFile = makeConfigFile({ alpha: spawnEntry("alpha") });
    cleanup.push(configFile);
    const { slimServer, client } = await startProxy(configFile);
    activeServers.push(slimServer);

    const result = await client.callTool({ name: "list_servers", arguments: {} });
    const text = JSON.stringify(result);
    expect(text).toContain("alpha");
    expect(text).toContain("ready");
  });

  it("slim_stats reports savings", async () => {
    const configFile = makeConfigFile({ alpha: spawnEntry("alpha") });
    cleanup.push(configFile);
    const { slimServer, client } = await startProxy(configFile);
    activeServers.push(slimServer);

    await client.listTools();
    const result = await client.callTool({ name: "slim_stats", arguments: {} });
    const text = JSON.stringify(result);
    expect(text).toContain("tokensBefore");
    expect(text).toContain("savingsPct");
  });

  it("writes session stats on stop", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ctxslim-statsit-"));
    cleanup.push(dir);
    process.env.CTX_SLIM_STATS_DIR = dir;
    const configFile = makeConfigFile({ alpha: spawnEntry("alpha") });
    cleanup.push(configFile);
    const { slimServer, client } = await startProxy(configFile, {}, true);
    await client.listTools();
    await slimServer.stop();
    const { summary } = loadStatsSummary();
    expect(summary.sessions).toBeGreaterThanOrEqual(1);
    expect(summary.avgTokensBefore).toBeGreaterThan(summary.avgTokensAfter);
    delete process.env.CTX_SLIM_STATS_DIR;
  });

  it("exclude glob removes tools from exposure and routing", async () => {
    const configFile = makeConfigFile({ alpha: { ...spawnEntry("alpha"), exclude: ["*_1"] } });
    cleanup.push(configFile);
    const { client } = await startProxy(configFile);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("alpha_tool_0");
    expect(names).not.toContain("alpha_tool_1");
    const result = await client.callTool({ name: "alpha_tool_1", arguments: { id: "x" } });
    expect(JSON.stringify(result)).toContain("Unknown tool");
  });

  it("include glob acts as allowlist", async () => {
    const configFile = makeConfigFile({ alpha: { ...spawnEntry("alpha"), include: ["*_0"] } });
    cleanup.push(configFile);
    const { client } = await startProxy(configFile);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("alpha_tool_0");
    expect(names).not.toContain("alpha_tool_3");
  });

  it("truncates oversized results with head+tail when output.maxChars is set", async () => {
    const configFile = makeConfigFile({ alpha: { ...spawnEntry("alpha"), output: { maxChars: 500 } } });
    cleanup.push(configFile);
    const { client } = await startProxy(configFile);
    const result = await client.callTool({ name: "alpha_tool_0__big", arguments: {} });
    const text = JSON.stringify(result);
    expect(text).toContain("[ctxslim: truncated");
    expect(text).toContain("END-SENTINEL");
    expect(text.length).toBeLessThan(2000);
  });

  it("does not compress results when output is not configured", async () => {
    const configFile = makeConfigFile({ alpha: spawnEntry("alpha") });
    cleanup.push(configFile);
    const { client } = await startProxy(configFile);
    const result = await client.callTool({ name: "alpha_tool_0__big", arguments: {} });
    const text = JSON.stringify(result);
    expect(text).toContain("END-SENTINEL");
    expect(text).not.toContain("[ctxslim: truncated");
  });

  it("adaptive ranking surfaces frequently used tools across sessions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ctxslim-adaptive-"));
    cleanup.push(dir);
    process.env.CTX_SLIM_STATS_DIR = dir;
    try {
      const configFile = makeConfigFile({ alpha: spawnEntry("alpha", 30), beta: spawnEntry("beta", 30) });
      cleanup.push(configFile);
      const { saveUsageMap } = await import("../src/config.js");
      saveUsageMap({ "alpha::alpha_tool_25": { count: 50, lastUsed: Date.now() } });
      const { client } = await startProxy(configFile, { maxTools: 8 });
      const { tools } = await client.listTools();
      const names = tools
        .filter((tool) => !["search_tools", "enable_tools", "describe_tools", "list_servers", "slim_stats"].includes(tool.name))
        .map((tool) => tool.name);
      expect(names).toContain("alpha_tool_25");
    } finally {
      delete process.env.CTX_SLIM_STATS_DIR;
    }
  });

  it("usage influences ranking of searched tools", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ctxslim-boost-"));
    cleanup.push(dir);
    process.env.CTX_SLIM_STATS_DIR = dir;
    const configFile = makeConfigFile({ alpha: spawnEntry("alpha", 30), beta: spawnEntry("beta", 30) });
    cleanup.push(configFile);
    try {
      const { client } = await startProxy(configFile, { maxTools: 12 });

      const hitNames = async (query: string): Promise<string[]> => {
        const result = (await client.callTool({ name: "search_tools", arguments: { query } })) as {
          content: { type: string; text: string }[];
        };
        const text = result.content[0]?.text ?? "";
        return [...text.matchAll(/^### (.+)$/gm)].map((match) => match[1]!);
      };

      const bigHits = await hitNames("big output");
      const alphaHits = await hitNames("alpha");
      expect(bigHits).toEqual(["alpha_tool_0__big", "beta_tool_0__big"]);
      expect(alphaHits).toEqual(["alpha_tool_0", "alpha_tool_1", "alpha_tool_2", "alpha_tool_3", "alpha_tool_4", "alpha_tool_5", "alpha_tool_6", "alpha_tool_7"]);

      const { tools } = await client.listTools();
      const nonMeta = tools
        .filter((tool) => !["search_tools", "enable_tools", "describe_tools", "list_servers", "slim_stats"].includes(tool.name))
        .map((tool) => tool.name);
      expect(nonMeta).toHaveLength(12);
      expect(nonMeta.slice(0, 10).sort()).toEqual([...bigHits, ...alphaHits].sort());
    } finally {
      delete process.env.CTX_SLIM_STATS_DIR;
    }
  });

  it("meters upstream calls to audit.jsonl", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ctxslim-meter-"));
    cleanup.push(dir);
    process.env.CTX_SLIM_STATS_DIR = dir;
    try {
      const configFile = makeConfigFile({ alpha: spawnEntry("alpha") });
      cleanup.push(configFile);
      const { slimServer, client } = await startProxy(configFile, {}, true);
      activeServers.push(slimServer);
      await client.callTool({ name: "alpha_tool_0", arguments: { id: "x" } });
      await client.callTool({ name: "alpha_tool_0", arguments: { id: "x" } });
      await client.callTool({ name: "alpha_tool_1", arguments: { id: "x", fail: true } });
      const { loadAuditRecords } = await import("../src/config.js");
      const { hashArgs } = await import("../src/audit.js");
      const { records } = loadAuditRecords();
      expect(records).toHaveLength(3);
      expect(records[0]).toMatchObject({ server: "alpha", tool: "alpha_tool_0", isError: false });
      expect(records[0].argsHash).toBe(hashArgs({ id: "x" }));
      expect(records[0].outChars).toBeGreaterThan(0);
      expect(records[0].reqChars).toBe(JSON.stringify({ id: "x" }).length);
      expect(records[2]).toMatchObject({ tool: "alpha_tool_1", isError: true });
      const raw = readFileSync(join(dir, "audit.jsonl"), "utf8");
      expect(raw).not.toContain('"id":"x"');
    } finally {
      delete process.env.CTX_SLIM_STATS_DIR;
    }
  });

  it("writes no audit lines when stats are disabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ctxslim-meter-"));
    cleanup.push(dir);
    process.env.CTX_SLIM_STATS_DIR = dir;
    try {
      const configFile = makeConfigFile({ alpha: spawnEntry("alpha") });
      cleanup.push(configFile);
      const { client } = await startProxy(configFile, {}, false);
      await client.callTool({ name: "alpha_tool_0", arguments: { id: "x" } });
      expect(existsSync(join(dir, "audit.jsonl"))).toBe(false);
    } finally {
      delete process.env.CTX_SLIM_STATS_DIR;
    }
  });

  it("disclosure emits stubs when enabled", async () => {
    const configFile = makeConfigFile({ alpha: spawnEntry("alpha") });
    cleanup.push(configFile);
    const { slimServer, client } = await startProxy(configFile, { disclosure: true });
    activeServers.push(slimServer);
    const { tools } = await client.listTools();
    const first = tools.find((tool) => tool.name === "alpha_tool_0");
    expect(first).toBeDefined();
    expect(first?.inputSchema).toEqual({ type: "object" });
    expect((first?.description ?? "").length).toBeLessThanOrEqual(120);
  });

  it("describe_tools returns full schemas in batch", async () => {
    const configFile = makeConfigFile({ alpha: spawnEntry("alpha") });
    cleanup.push(configFile);
    const { slimServer, client } = await startProxy(configFile, { disclosure: true });
    activeServers.push(slimServer);
    const result = await client.callTool({ name: "describe_tools", arguments: { tools: ["alpha_tool_0", "nope"] } });
    const text = JSON.stringify(result);
    expect(text).toContain("alpha_tool_0");
    expect(text).toContain("arguments:");
    expect(text).toContain("nope");
  });

  it("describe_tools rejects empty tools array", async () => {
    const configFile = makeConfigFile({ alpha: spawnEntry("alpha") });
    cleanup.push(configFile);
    const { slimServer, client } = await startProxy(configFile, { disclosure: true });
    activeServers.push(slimServer);
    const result = await client.callTool({ name: "describe_tools", arguments: { tools: [] } });
    expect(JSON.stringify(result)).toContain("non-empty");
  });

  it("stub-listed tools still callable", async () => {
    const configFile = makeConfigFile({ alpha: spawnEntry("alpha") });
    cleanup.push(configFile);
    const { slimServer, client } = await startProxy(configFile, { disclosure: true });
    activeServers.push(slimServer);
    const result = await client.callTool({ name: "alpha_tool_1", arguments: { id: "x" } });
    expect(JSON.stringify(result)).toContain("alpha handled alpha_tool_1");
  });

  it("meta tools stay full with disclosure on", async () => {
    const configFile = makeConfigFile({ alpha: spawnEntry("alpha") });
    cleanup.push(configFile);
    const { slimServer, client } = await startProxy(configFile, { disclosure: true });
    activeServers.push(slimServer);
    const { tools } = await client.listTools();
    const search = tools.find((tool) => tool.name === "search_tools");
    expect(Object.keys((search?.inputSchema as Record<string, unknown>).properties as Record<string, unknown>)).toContain("query");
  });

  it("full schemas by default without disclosure flag", async () => {
    const configFile = makeConfigFile({ alpha: spawnEntry("alpha") });
    cleanup.push(configFile);
    const { slimServer, client } = await startProxy(configFile);
    activeServers.push(slimServer);
    const { tools } = await client.listTools();
    const first = tools.find((tool) => tool.name === "alpha_tool_0");
    expect(Object.keys((first?.inputSchema as Record<string, unknown>).properties as Record<string, unknown>)).toContain("id");
  });

  it("config pins seed session pins", async () => {
    const configFile = makeConfigFile({ alpha: spawnEntry("alpha") });
    cleanup.push(configFile);
    const { slimServer, client } = await startProxy(configFile, { maxTools: 2, pins: ["alpha::alpha_tool_5"] });
    activeServers.push(slimServer);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("alpha_tool_5");
  });

  it("slim_stats reports disclosure flag", async () => {
    const configFile = makeConfigFile({ alpha: spawnEntry("alpha") });
    cleanup.push(configFile);
    const { slimServer, client } = await startProxy(configFile, { disclosure: true });
    activeServers.push(slimServer);
    await client.listTools();
    const result = await client.callTool({ name: "slim_stats", arguments: {} });
    expect(JSON.stringify(result)).toContain('\\"disclosure\\": true');
  });
});
