import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ServerEntry, ToolDefinition } from "./types.js";
import { isStdioEntry } from "./types.js";

export type UpstreamStatus = "connecting" | "ready" | "error" | "closed";

export type PromptDefinition = { name: string; description?: string; arguments?: unknown; [key: string]: unknown };

export type ResourceDefinition = { uri?: string; uriTemplate?: string; name?: string; description?: string; [key: string]: unknown };

const BASE_ENV = ["PATH", "HOME", "USER", "SHELL", "TERM", "TMPDIR", "LANG", "LOGNAME", "XDG_CONFIG_HOME", "SYSTEMROOT", "COMSPEC", "APPDATA"] as const;

const baseEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const key of BASE_ENV) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
};

const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

export class Upstream {
  readonly name: string;
  readonly entry: ServerEntry;
  status: UpstreamStatus = "connecting";
  error: string | null = null;
  tools: ToolDefinition[] = [];
  prompts: PromptDefinition[] = [];
  resources: ResourceDefinition[] = [];
  templates: ResourceDefinition[] = [];
  serverInfo: { name: string; version: string };

  private client: Client | null = null;
  private closedIntentionally = false;
  private reconnectAttempts = 0;
  private readonly maxReconnects = 3;
  private onToolsChanged: () => void;
  private onLog: (message: string) => void;

  constructor(name: string, entry: ServerEntry, hooks: { onToolsChanged: () => void; onLog: (message: string) => void }) {
    this.name = name;
    this.entry = entry;
    this.serverInfo = { name, version: "unknown" };
    this.onToolsChanged = hooks.onToolsChanged;
    this.onLog = hooks.onLog;
  }

  get transportKind(): "stdio" | "http" {
    return isStdioEntry(this.entry) ? "stdio" : "http";
  }

  async start(connectTimeoutMs = 15000): Promise<void> {
    this.closedIntentionally = false;
    this.status = "connecting";
    this.error = null;
    const client = new Client({ name: "context-slim", version: "0.1.0" });
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      void this.refreshTools().then(this.onToolsChanged).catch(() => undefined);
    });
    try {
      const transport = isStdioEntry(this.entry)
        ? new StdioClientTransport({
            command: this.entry.command,
            args: this.entry.args ?? [],
            env: { ...baseEnv(), ...(this.entry.env ?? {}) },
            ...(this.entry.cwd ? { cwd: this.entry.cwd } : {}),
          })
        : new StreamableHTTPClientTransport(new URL(this.entry.url), {
            requestInit: this.entry.headers ? { headers: this.entry.headers } : undefined,
          });
      await withTimeout(client.connect(transport), connectTimeoutMs, `server "${this.name}"`);
      this.client = client;
      this.serverInfo = client.getServerVersion() ?? { name: this.name, version: "unknown" };
      this.status = "ready";
      this.reconnectAttempts = 0;
      client.onclose = () => {
        if (!this.closedIntentionally) void this.handleUnexpectedClose();
      };
      await this.refreshAll();
    } catch (err) {
      this.status = "error";
      this.error = err instanceof Error ? err.message : String(err);
      try {
        await client.close();
      } catch {
        return;
      }
      throw new Error(`Failed to connect to server "${this.name}": ${this.error}`);
    }
  }

  private async handleUnexpectedClose(): Promise<void> {
    this.status = "error";
    this.error = "connection closed unexpectedly";
    if (this.reconnectAttempts >= this.maxReconnects) {
      this.onLog(`server "${this.name}" is down after ${this.maxReconnects} reconnect attempts`);
      return;
    }
    this.reconnectAttempts += 1;
    const delay = Math.min(2000 * this.reconnectAttempts, 8000);
    this.onLog(`server "${this.name}" disconnected, reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      await this.start();
      this.onToolsChanged();
    } catch {
      return;
    }
  }

  private async refreshAll(): Promise<void> {
    await this.refreshTools();
    this.prompts = await this.safeList("listPrompts", "prompts");
    this.resources = await this.safeList("listResources", "resources");
    this.templates = await this.safeList("listResourceTemplates", "resourceTemplates");
  }

  async refreshTools(): Promise<void> {
    if (!this.client) return;
    this.tools = await this.listPages("listTools", "tools");
  }

  private async listPages<K extends "listTools" | "listPrompts" | "listResources" | "listResourceTemplates">(
    method: K,
    key: "tools" | "prompts" | "resources" | "resourceTemplates"
  ): Promise<any[]> {
    const client = this.client;
    if (!client) return [];
    const all: any[] = [];
    let cursor: string | undefined;
    do {
      const page = await withTimeout(
        (client[method] as (args: { cursor?: string }) => Promise<Record<string, unknown>>)({ cursor }),
        30000,
        `listing ${key} from "${this.name}"`
      );
      const items = page[key];
      if (Array.isArray(items)) all.push(...items);
      cursor = typeof page.nextCursor === "string" ? page.nextCursor : undefined;
    } while (cursor);
    return all;
  }

  private async safeList<K extends "listPrompts" | "listResources" | "listResourceTemplates">(
    method: K,
    key: "prompts" | "resources" | "resourceTemplates"
  ): Promise<any[]> {
    try {
      return await this.listPages(method, key);
    } catch {
      return [];
    }
  }

  async callTool(name: string, args: Record<string, unknown> | undefined): Promise<unknown> {
    if (!this.client || this.status !== "ready") {
      throw new Error(`server "${this.name}" is not ready (${this.status}${this.error ? `: ${this.error}` : ""})`);
    }
    return withTimeout(this.client.callTool({ name, arguments: args ?? {} }), 120000, `tool "${name}"`);
  }

  async readResource(uri: string): Promise<unknown> {
    if (!this.client || this.status !== "ready") {
      throw new Error(`server "${this.name}" is not ready`);
    }
    return withTimeout(this.client.readResource({ uri }), 30000, `resource "${uri}"`);
  }

  async getPrompt(name: string, args: Record<string, string> | undefined): Promise<unknown> {
    if (!this.client || this.status !== "ready") {
      throw new Error(`server "${this.name}" is not ready`);
    }
    return withTimeout(this.client.getPrompt({ name, arguments: args }), 30000, `prompt "${name}"`);
  }

  async close(): Promise<void> {
    this.closedIntentionally = true;
    this.status = "closed";
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        return;
      } finally {
        this.client = null;
      }
    }
  }
}
