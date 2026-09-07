import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ServerResult } from "@modelcontextprotocol/sdk/types.js";
import { compressTool } from "./compressor.js";
import { DEFAULT_DESCRIPTION_BUDGET, DEFAULT_MAX_TOOLS } from "./types.js";
import type { ContextSlimConfig, SlimMode, ToolDefinition } from "./types.js";
import { META_TOOLS, formatSearchResults, formatServerList } from "./meta.js";
import { ToolIndex, usageScore } from "./ranker.js";
import type { UsageRecord } from "./ranker.js";
import { saveSessionStats } from "./config.js";
import type { SessionStats } from "./config.js";
import { Upstream } from "./upstream.js";
import type { PromptDefinition, ResourceDefinition } from "./upstream.js";
import { BANNER, bold, cyan, dim, fmtTokens, green, red } from "./ui.js";

type ResolvedTool = { key: string; server: string; originalName: string; exposedName: string; tool: ToolDefinition };

const nowIso = (): string => new Date().toISOString();

export class ContextSlimServer {
  private readonly config: ContextSlimConfig;
  private readonly statsEnabled: boolean;
  private readonly quiet: boolean;
  private readonly server: Server;
  private readonly upstreams = new Map<string, Upstream>();
  private readonly index = new ToolIndex();
  private readonly resolved = new Map<string, ResolvedTool>();
  private readonly routeByExposedName = new Map<string, string>();
  private readonly usage = new Map<string, UsageRecord>();
  private readonly pinned = new Set<string>();
  private readonly promptRoutes = new Map<string, { server: string; name: string }>();
  private readonly resourceRoutes = new Map<string, string>();
  private readonly templateRoutes = new Map<string, string>();
  private metaPrefix = "";
  private lastQuery: string | null = null;
  private toolsUpstream = 0;
  private tokensBefore = 0;
  private tokensAfter = 0;
  private callsRouted = 0;
  private readonly startedAt = new Date();
  private started = false;

  constructor(config: ContextSlimConfig, opts: { stats?: boolean; quiet?: boolean } = {}) {
    this.config = config;
    this.statsEnabled = opts.stats ?? config.slim?.stats ?? true;
    this.quiet = opts.quiet ?? false;
    this.server = new Server(
      { name: "ctxslim", version: "0.2.0" },
      {
        capabilities: {
          tools: { listChanged: true },
          prompts: { listChanged: true },
          resources: { listChanged: true },
        },
      }
    );
  }

  get mode(): SlimMode {
    return this.config.slim?.mode ?? "auto";
  }

  private get maxTools(): number {
    return this.config.slim?.maxTools && this.config.slim.maxTools > 0 ? this.config.slim.maxTools : DEFAULT_MAX_TOOLS;
  }

  private get descriptionBudget(): number {
    return this.config.slim?.descriptionBudget && this.config.slim.descriptionBudget > 0
      ? this.config.slim.descriptionBudget
      : DEFAULT_DESCRIPTION_BUDGET;
  }

  private get connectTimeout(): number {
    return this.config.slim?.connectTimeout && this.config.slim.connectTimeout > 0
      ? this.config.slim.connectTimeout
      : 15000;
  }

  private log(message: string): void {
    if (this.quiet) return;
    process.stderr.write(`${dim("[ctxslim]")} ${message}\n`);
  }

  private logError(message: string): void {
    process.stderr.write(`${red("[ctxslim]")} ${message}\n`);
  }

  async start(transport?: Transport): Promise<void> {
    const entries = Object.entries(this.config.mcpServers);
    if (entries.length === 0) {
      throw new Error("No MCP servers configured. Add servers to your config's mcpServers object.");
    }
    this.log(`${dim("connecting to")} ${entries.length} server${entries.length === 1 ? "" : "s"}${this.quiet ? "" : " ..."}`);
    const upstreams = entries.map(([name, entry]) => {
      const upstream = new Upstream(name, entry, {
        onToolsChanged: () => this.rebuildIndex(),
        onLog: (message) => this.log(message),
      });
      this.upstreams.set(name, upstream);
      return { name, upstream };
    });
    const results = await Promise.allSettled(upstreams.map(({ upstream }) => upstream.start(this.connectTimeout)));
    const failed = results.filter((result) => result.status === "rejected");
    for (let i = 0; i < upstreams.length; i += 1) {
      const { name } = upstreams[i]!;
      const result = results[i];
      if (result && result.status === "rejected") {
        const reason = result.reason;
        this.logError(`server "${name}" failed: ${reason instanceof Error ? reason.message : String(reason)}`);
      } else {
        this.log(`${green("✓")} ${name} ${dim(`(${this.upstreams.get(name)?.tools.length ?? 0} tools)`)}`);
      }
    }
    if (failed.length === entries.length) {
      throw new Error(
        `All ${entries.length} upstream server${entries.length === 1 ? "" : "s"} failed to connect. ` +
          "Check that the commands in your config work on their own."
      );
    }
    this.rebuildIndex();
    this.registerHandlers();
    await this.server.connect(transport ?? new StdioServerTransport());
    this.started = true;
  }

  private registerHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: this.exposedTools() }));
    this.server.setRequestHandler(CallToolRequestSchema, async (request) =>
      (await this.handleCallTool(request.params.name, request.params.arguments)) as ServerResult
    );
    this.server.setRequestHandler(ListPromptsRequestSchema, () => ({
      prompts: [...this.upstreams.values()].filter((upstream) => upstream.status === "ready").flatMap((upstream) => upstream.prompts),
    }));
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const route = this.promptRoutes.get(request.params.name);
      if (!route) throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${request.params.name}`);
      const upstream = this.upstreams.get(route.server);
      if (!upstream) throw new McpError(ErrorCode.InvalidParams, `Server "${route.server}" is not available`);
      const result = (await upstream.getPrompt(route.name, request.params.arguments as Record<string, string> | undefined)) as ServerResult;
      return result;
    });
    this.server.setRequestHandler(ListResourcesRequestSchema, () => ({
      resources: [...this.upstreams.values()].filter((upstream) => upstream.status === "ready").flatMap((upstream) => upstream.resources),
    }));
    this.server.setRequestHandler(ListResourceTemplatesRequestSchema, () => ({
      resourceTemplates: [...this.upstreams.values()].filter((upstream) => upstream.status === "ready").flatMap((upstream) => upstream.templates),
    }));
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const serverName = this.resourceRoutes.get(request.params.uri) ?? this.matchTemplate(request.params.uri);
      if (!serverName) throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${request.params.uri}`);
      const upstream = this.upstreams.get(serverName);
      if (!upstream) throw new McpError(ErrorCode.InvalidParams, `Server "${serverName}" is not available`);
      const result = (await upstream.readResource(request.params.uri)) as ServerResult;
      return result;
    });
  }

  private matchTemplate(uri: string): string | undefined {
    for (const [template, server] of this.templateRoutes) {
      const regex = new RegExp("^" + template.replace(/\{[^}]+\}/g, "[^/]+") + "$");
      if (regex.test(uri)) return server;
    }
    return undefined;
  }

  private rebuildIndex(): void {
    const entries: { key: string; tool: ToolDefinition; server: string }[] = [];
    this.promptRoutes.clear();
    this.resourceRoutes.clear();
    this.templateRoutes.clear();
    const promptNames = new Map<string, string[]>();
    const toolNames = new Map<string, number>();
    for (const [serverName, upstream] of this.upstreams) {
      if (upstream.status !== "ready") continue;
      for (const tool of upstream.tools) {
        toolNames.set(tool.name, (toolNames.get(tool.name) ?? 0) + 1);
      }
      for (const prompt of upstream.prompts as PromptDefinition[]) {
        promptNames.set(prompt.name, [...(promptNames.get(prompt.name) ?? []), serverName]);
      }
      for (const resource of upstream.resources as ResourceDefinition[]) {
        if (typeof resource.uri === "string") this.resourceRoutes.set(resource.uri, serverName);
      }
      for (const template of upstream.templates as ResourceDefinition[]) {
        if (typeof template.uriTemplate === "string") this.templateRoutes.set(template.uriTemplate, serverName);
      }
    }
    const needsPrefix = (name: string): boolean => (toolNames.get(name) ?? 0) > 1;
    for (const [serverName, upstream] of this.upstreams) {
      if (upstream.status !== "ready") continue;
      for (const tool of upstream.tools) {
        const key = `${serverName}::${tool.name}`;
        entries.push({ key, tool, server: serverName });
      }
      for (const prompt of upstream.prompts as PromptDefinition[]) {
        const owners = promptNames.get(prompt.name) ?? [];
        const exposed = owners.length > 1 ? `${serverName}__${prompt.name}` : prompt.name;
        this.promptRoutes.set(exposed, { server: serverName, name: prompt.name });
      }
    }
    this.index.rebuild(entries);
    this.resolved.clear();
    this.routeByExposedName.clear();
    this.toolsUpstream = entries.length;
    for (const entry of entries) {
      const exposedName = needsPrefix(entry.tool.name) ? `${entry.server}__${entry.tool.name}` : entry.tool.name;
      const resolvedTool: ResolvedTool = {
        key: entry.key,
        server: entry.server,
        originalName: entry.tool.name,
        exposedName,
        tool: entry.tool,
      };
      this.resolved.set(entry.key, resolvedTool);
      this.routeByExposedName.set(exposedName, entry.key);
    }
    const metaNames = new Set(META_TOOLS.map((tool) => tool.name));
    this.metaPrefix = [...toolNames.keys()].some((name) => metaNames.has(name)) ? "slim__" : "";
    this.tokensBefore = entries.reduce((sum, entry) => sum + this.tokenCountOf(entry.tool), 0);
  }

  private tokenCountOf(tool: ToolDefinition): number {
    return compressTool(tool, this.descriptionBudget).tokensBefore;
  }

  private compressedOf(tool: ToolDefinition): ToolDefinition {
    return compressTool(tool, this.descriptionBudget).tool;
  }

  private scoreKey(key: string, scores: Map<string, number>, now: number): number {
    let score = scores.get(key) ?? 0;
    if (this.pinned.has(key)) score += 1000;
    score += usageScore(this.usage.get(key), now);
    return score;
  }

  private exposedTools(): ToolDefinition[] {
    const now = Date.now();
    const readyTools: ResolvedTool[] = [];
    for (const resolvedTool of this.resolved.values()) {
      const upstream = this.upstreams.get(resolvedTool.server);
      if (upstream?.status === "ready") readyTools.push(resolvedTool);
    }
    const searchScores = new Map<string, number>();
    if (this.lastQuery) {
      for (const hit of this.index.search(this.lastQuery, Number.MAX_SAFE_INTEGER)) {
        searchScores.set(hit.key, hit.score);
      }
    }
    let selected: ResolvedTool[];
    if (this.mode === "off") {
      selected = readyTools;
    } else if (this.mode === "manual") {
      const allowlist = this.config.slim?.allowlist;
      selected = readyTools.filter((resolvedTool) => this.pinned.has(resolvedTool.key) || !allowlist || allowlist.includes(resolvedTool.server));
    } else {
      const ranked = [...readyTools].sort((a, b) => this.scoreKey(b.key, searchScores, now) - this.scoreKey(a.key, searchScores, now));
      selected = ranked.slice(0, this.maxTools);
    }
    const compress = this.mode !== "off";
    const exposed = selected.map((resolvedTool) => {
      if (!compress) {
        return { ...resolvedTool.tool, name: resolvedTool.exposedName } as ToolDefinition;
      }
      const compressed = this.compressedOf(resolvedTool.tool);
      return { ...compressed, name: resolvedTool.exposedName } as ToolDefinition;
    });
    this.tokensAfter = exposed.reduce((sum, tool) => {
      const { tokensAfter } = compressTool(tool, Number.MAX_SAFE_INTEGER);
      return sum + tokensAfter;
    }, 0);
    if (this.mode !== "off") {
      for (const meta of META_TOOLS) {
        exposed.push({ ...meta, name: `${this.metaPrefix}${meta.name}` });
      }
    }
    return exposed;
  }

  private metaName(name: string): string {
    return name.replace(/^slim__/, "");
  }

  private async handleCallTool(exposedName: string, args: Record<string, unknown> | undefined): Promise<unknown> {
    const metaName = this.metaName(exposedName);
    const meta = META_TOOLS.find((tool) => tool.name === metaName);
    if (meta && (exposedName === `${this.metaPrefix}${meta.name}` || (this.mode !== "off" && this.metaPrefix === ""))) {
      return this.handleMetaTool(meta.name, args);
    }
    const key = this.routeByExposedName.get(exposedName);
    if (!key) {
      return {
        content: [
          {
            type: "text",
            text: `Unknown tool: "${exposedName}". Use search_tools to discover available tools.`,
          },
        ],
        isError: true,
      };
    }
    const resolvedTool = this.resolved.get(key);
    if (!resolvedTool) {
      return { content: [{ type: "text", text: `Unknown tool: "${exposedName}"` }], isError: true };
    }
    const upstream = this.upstreams.get(resolvedTool.server);
    if (!upstream || upstream.status !== "ready") {
      return {
        content: [{ type: "text", text: `Server "${resolvedTool.server}" is not connected. Try again shortly.` }],
        isError: true,
      };
    }
    try {
      const result = await upstream.callTool(resolvedTool.originalName, args);
      this.usage.set(key, {
        count: (this.usage.get(key)?.count ?? 0) + 1,
        lastUsed: Date.now(),
      });
      this.callsRouted += 1;
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Tool "${exposedName}" failed: ${message}` }], isError: true };
    }
  }

  private async handleMetaTool(name: string, args: Record<string, unknown> | undefined): Promise<unknown> {
    switch (name) {
      case "search_tools":
        return this.handleSearchTools(args);
      case "enable_tools":
        return this.handleEnableTools(args);
      case "list_servers":
        return { content: [{ type: "text", text: this.renderServerList() }] };
      case "slim_stats":
        return { content: [{ type: "text", text: this.renderStats() }] };
      default:
        return { content: [{ type: "text", text: `Unknown meta tool: ${name}` }], isError: true };
    }
  }

  private async handleSearchTools(args: Record<string, unknown> | undefined): Promise<unknown> {
    const query = typeof args?.query === "string" ? args.query : "";
    if (!query.trim()) {
      return { content: [{ type: "text", text: "Provide a non-empty `query` string." }], isError: true };
    }
    const rawLimit = typeof args?.limit === "number" ? args.limit : 8;
    const limit = Math.max(1, Math.min(50, Math.floor(rawLimit)));
    const hits = this.index.search(query, limit);
    this.lastQuery = query;
    const now = Date.now();
    for (const hit of hits) {
      this.usage.set(hit.key, { count: Math.max(this.usage.get(hit.key)?.count ?? 0, 1), lastUsed: now });
    }
    const formatted = hits.map((hit) => {
      const resolvedTool = this.resolved.get(hit.key);
      if (!resolvedTool) return null;
      return {
        name: resolvedTool.exposedName,
        server: resolvedTool.server,
        tool: this.compressedOf(resolvedTool.tool),
      };
    });
    const text = formatSearchResults(formatted.filter((item): item is NonNullable<typeof item> => item !== null), query);
    await this.notifyToolsChanged();
    return { content: [{ type: "text", text }] };
  }

  private async handleEnableTools(args: Record<string, unknown> | undefined): Promise<unknown> {
    const tools = Array.isArray(args?.tools) ? args.tools.filter((item): item is string => typeof item === "string") : [];
    if (tools.length === 0) {
      return { content: [{ type: "text", text: "Provide a non-empty `tools` array of tool names." }], isError: true };
    }
    const enabled: string[] = [];
    const missing: string[] = [];
    for (const name of tools) {
      const key = this.routeByExposedName.get(name) ?? (this.resolved.has(name) ? name : undefined);
      if (key) {
        this.pinned.add(key);
        enabled.push(name);
      } else {
        missing.push(name);
      }
    }
    const lines = [`Pinned ${enabled.length} tool${enabled.length === 1 ? "" : "s"} for this session.`];
    if (enabled.length > 0) lines.push(`  enabled: ${enabled.join(", ")}`);
    if (missing.length > 0) lines.push(`  not found (ignored): ${missing.join(", ")}`);
    await this.notifyToolsChanged();
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  private renderServerList(): string {
    const rows = [...this.upstreams.values()].map((upstream) => ({
      name: upstream.name,
      status: upstream.status,
      toolCount: upstream.tools.length,
      transport: upstream.transportKind,
    }));
    return formatServerList(rows);
  }

  private renderStats(): string {
    const savings = this.tokensBefore > 0 ? ((this.tokensBefore - this.tokensAfter) / this.tokensBefore) * 100 : 0;
    return JSON.stringify(
      {
        mode: this.mode,
        servers: this.upstreams.size,
        toolsUpstream: this.toolsUpstream,
        tokensBefore: Math.round(this.tokensBefore),
        tokensAfter: Math.round(this.tokensAfter),
        savingsPct: Number(savings.toFixed(1)),
        callsRouted: this.callsRouted,
        uptimeMinutes: Number(((Date.now() - this.startedAt.getTime()) / 60000).toFixed(1)),
      },
      null,
      2
    );
  }

  private async notifyToolsChanged(): Promise<void> {
    try {
      await this.server.notification({ method: "notifications/tools/list_changed" });
    } catch {
      return;
    }
  }

  async stop(): Promise<void> {
    if (this.statsEnabled && this.started) this.writeSessionStats();
    await Promise.allSettled([...this.upstreams.values()].map((upstream) => upstream.close()));
    try {
      await this.server.close();
    } catch {
      return;
    }
  }

  private writeSessionStats(): void {
    const endedAt = nowIso();
    const stats: SessionStats = {
      startedAt: this.startedAt.toISOString(),
      endedAt,
      configSource: "session",
      mode: this.mode,
      servers: this.upstreams.size,
      toolsUpstream: this.toolsUpstream,
      tokensBefore: Math.round(this.tokensBefore),
      tokensAfter: Math.round(this.tokensAfter),
      callsRouted: this.callsRouted,
    };
    saveSessionStats(stats);
  }

  printBanner(source: string): void {
    if (this.quiet) return;
    process.stderr.write(`${cyan(BANNER)}\n`);
    process.stderr.write(`  ${bold("CtxSlim")} ${dim("v0.2.0")} ${dim("— MCP without the bloat")}\n\n`);
    process.stderr.write(`  ${dim("config")}   ${source}\n`);
    process.stderr.write(`  ${dim("mode")}     ${this.mode}\n`);
    if (this.tokensBefore > 0 && this.tokensAfter > 0 && this.mode !== "off") {
      const savings = ((this.tokensBefore - this.tokensAfter) / this.tokensBefore) * 100;
      process.stderr.write(
        `  ${dim("context")}  ${fmtTokens(this.tokensBefore)} → ${fmtTokens(this.tokensAfter)} tokens ` +
          `${green(`-${savings.toFixed(0)}%`)}\n`
      );
    }
    process.stderr.write(`\n  ${dim("stdio proxy running. ctrl+c to stop.")}\n\n`);
  }

  get sessionSummary(): { tokensBefore: number; tokensAfter: number; callsRouted: number } {
    return { tokensBefore: this.tokensBefore, tokensAfter: this.tokensAfter, callsRouted: this.callsRouted };
  }
}
