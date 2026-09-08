import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ContextSlimServer } from "../src/server.js";

const fakeServer = fileURLToPath(new URL("./fake-server.mjs", import.meta.url));

const makeConfig = (servers: Record<string, unknown>) => ({ mcpServers: servers, slim: {} });

const spawnEntry = (name: string, toolCount = 6) => ({
  command: process.execPath,
  args: [fakeServer, name, String(toolCount)],
});

describe("lazy connect", () => {
  it("start() resolves before upstreams and tools/list works immediately, tools arrive via list_changed", async () => {
    const slimServer = new ContextSlimServer(makeConfig({ alpha: spawnEntry("alpha", 30), beta: spawnEntry("beta", 30) }), {});
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    let listChanged = 0;
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      listChanged += 1;
    });
    const t0 = Date.now();
    await Promise.all([slimServer.start(serverTransport), client.connect(clientTransport)]);
    expect(Date.now() - t0).toBeLessThan(3000);
    const initial = await client.listTools();
    expect(Array.isArray(initial.tools)).toBe(true);
    await vi.waitFor(
      async () => {
        const { tools } = await client.listTools();
        expect(tools.some((tool) => tool.name === "alpha_tool_0")).toBe(true);
      },
      { timeout: 15000, interval: 250 }
    );
    expect(listChanged).toBeGreaterThanOrEqual(1);
    await slimServer.stop();
  });

  it("tools/list returns meta tools immediately even when an upstream hangs", async () => {
    const slimServer = new ContextSlimServer(makeConfig({ slow: { command: "sleep", args: ["30"] } }), {});
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([slimServer.start(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain("search_tools");
    await slimServer.stop();
  });
});
