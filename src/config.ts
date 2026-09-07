import { readFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { compressTool, toolTokenCount } from "./compressor.js";
import type { ContextSlimConfig, ServerEntry, SlimConfig, SlimMode, ToolDefinition } from "./types.js";
import { DEFAULT_DESCRIPTION_BUDGET } from "./types.js";

const IS_SLIM = /^(node\/)?(context-slim|@[\w.-]+\/context-slim)$/;

const looksLikeSlim = (entry: Record<string, unknown>): boolean => {
  const args = Array.isArray(entry.args) ? entry.args.map(String) : [];
  const command = typeof entry.command === "string" ? entry.command : "";
  const packageSpecs = [...args, command].map((value) => value.replace(/^.*[/\\]/, "").replace(/\.js$/, ""));
  return packageSpecs.some((value) => IS_SLIM.test(value));
};

export const normalizeConfig = (raw: unknown, source: string): ContextSlimConfig => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Config at ${source} must be a JSON object`);
  }
  const record = raw as Record<string, unknown>;
  const serversRaw = record.mcpServers ?? record.servers;
  if (!serversRaw || typeof serversRaw !== "object" || Array.isArray(serversRaw)) {
    throw new Error(`Config at ${source} is missing an "mcpServers" object`);
  }
  const mcpServers: Record<string, ServerEntry> = {};
  for (const [name, entry] of Object.entries(serversRaw as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.command === "string") {
      if (looksLikeSlim(e)) continue;
      mcpServers[name] = {
        command: e.command,
        ...(Array.isArray(e.args) ? { args: e.args.map(String) } : {}),
        ...(e.env && typeof e.env === "object" ? { env: e.env as Record<string, string> } : {}),
        ...(typeof e.cwd === "string" ? { cwd: e.cwd } : {}),
      };
    } else if (typeof e.url === "string") {
      mcpServers[name] = {
        url: e.url,
        ...(e.headers && typeof e.headers === "object" ? { headers: e.headers as Record<string, string> } : {}),
      };
    } else {
      throw new Error(`Server "${name}" in ${source} has neither "command" nor "url"`);
    }
  }
  if (Object.keys(mcpServers).length === 0) {
    throw new Error(`Config at ${source} contains no usable MCP servers (entries using "command" or "url")`);
  }
  const slimRaw = record.slim && typeof record.slim === "object" ? (record.slim as Record<string, unknown>) : {};
  const modes = new Set(["auto", "manual", "off"]);
  if (slimRaw.mode !== undefined && !modes.has(slimRaw.mode as string)) {
    throw new Error(`slim.mode must be one of: auto, manual, off`);
  }
  const slim: SlimConfig = {
    ...(slimRaw.mode !== undefined ? { mode: slimRaw.mode as SlimMode } : {}),
    ...(slimRaw.maxTools !== undefined ? { maxTools: Number(slimRaw.maxTools) } : {}),
    ...(Array.isArray(slimRaw.pins) ? { pins: slimRaw.pins.map(String) } : {}),
    ...(Array.isArray(slimRaw.allowlist) ? { allowlist: slimRaw.allowlist.map(String) } : {}),
    ...(slimRaw.descriptionBudget !== undefined ? { descriptionBudget: Number(slimRaw.descriptionBudget) } : {}),
    ...(slimRaw.stats !== undefined ? { stats: Boolean(slimRaw.stats) } : {}),
  };
  return { mcpServers, slim };
};

const KNOWN_CLIENT_PATHS = (home: string): { path: string; serversKey: string | null; label: string }[] => [
  { path: join(home, ".claude", "claude_desktop_config.json"), serversKey: null, label: "Claude Desktop" },
  { path: join(home, ".config", "Claude", "claude_desktop_config.json"), serversKey: null, label: "Claude Desktop" },
  { path: join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"), serversKey: null, label: "Claude Desktop" },
  { path: join(home, ".cursor", "mcp.json"), serversKey: null, label: "Cursor" },
  { path: join(home, ".codeium", "windsurf", "mcp_config.json"), serversKey: null, label: "Windsurf" },
  { path: join(home, ".config", "Code", "User", "mcp.json"), serversKey: "servers", label: "VS Code" },
  { path: join(home, ".claude.json"), serversKey: null, label: "Claude Code" },
];

export type LoadedConfig = {
  config: ContextSlimConfig;
  source: string;
  label: string;
};

export const loadConfig = (explicitPath?: string, cwd = process.cwd()): LoadedConfig => {
  const home = homedir();
  if (explicitPath) {
    const path = resolve(explicitPath);
    if (!existsSync(path)) {
      throw new Error(`Config file not found: ${path}`);
    }
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return { config: normalizeConfig(raw, path), source: path, label: "config file" };
  }
  const localPath = join(cwd, "context-slim.json");
  if (existsSync(localPath)) {
    const raw = JSON.parse(readFileSync(localPath, "utf8"));
    return { config: normalizeConfig(raw, localPath), source: localPath, label: "context-slim.json" };
  }
  const searched: string[] = [];
  for (const candidate of KNOWN_CLIENT_PATHS(home)) {
    if (!existsSync(candidate.path)) {
      searched.push(candidate.path);
      continue;
    }
    try {
      const raw = JSON.parse(readFileSync(candidate.path, "utf8"));
      const body = candidate.serversKey ? (raw as Record<string, unknown>)[candidate.serversKey] : raw;
      const config = normalizeConfig({ mcpServers: body }, candidate.path);
      return { config, source: candidate.path, label: candidate.label };
    } catch {
      searched.push(candidate.path);
    }
  }
  throw new Error(
    [
      "No MCP config found. Context Slim looked for:",
      ...KNOWN_CLIENT_PATHS(home).map((candidate) => `  - ${candidate.path}`),
      "",
      "Fix it by doing one of:",
      '  1. Run `context-slim --config /path/to/your/mcp.json`',
      "  2. Create a context-slim.json in this directory",
    ].join("\n")
  );
};

export const describeConfig = (config: ContextSlimConfig): string[] => {
  const lines: string[] = [];
  for (const [name, entry] of Object.entries(config.mcpServers)) {
    const detail = "command" in entry ? `${entry.command}${entry.args ? " " + entry.args.join(" ") : ""}` : entry.url;
    lines.push(`  ${name}: ${detail}`);
  }
  return lines;
};

export type SessionStats = {
  startedAt: string;
  endedAt: string;
  configSource: string;
  mode: SlimMode;
  servers: number;
  toolsUpstream: number;
  tokensBefore: number;
  tokensAfter: number;
  callsRouted: number;
};

const statsDir = (): string => process.env.CTX_SLIM_STATS_DIR ?? join(homedir(), ".context-slim");

export const saveSessionStats = (stats: SessionStats): void => {
  try {
    const dir = statsDir();
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "stats.jsonl"), JSON.stringify(stats) + "\n");
  } catch {
    return;
  }
};

export type StatsSummary = {
  sessions: number;
  totalCalls: number;
  avgTokensBefore: number;
  avgTokensAfter: number;
  avgSavingsPct: number;
};

export const loadStatsSummary = (): { summary: StatsSummary; lines: SessionStats[] } => {
  const file = join(statsDir(), "stats.jsonl");
  if (!existsSync(file)) return { summary: { sessions: 0, totalCalls: 0, avgTokensBefore: 0, avgTokensAfter: 0, avgSavingsPct: 0 }, lines: [] };
  const lines = readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SessionStats);
  const sessions = lines.length;
  const totalCalls = lines.reduce((sum, line) => sum + line.callsRouted, 0);
  const avgTokensBefore = sessions ? lines.reduce((sum, line) => sum + line.tokensBefore, 0) / sessions : 0;
  const avgTokensAfter = sessions ? lines.reduce((sum, line) => sum + line.tokensAfter, 0) / sessions : 0;
  const avgSavingsPct = avgTokensBefore > 0 ? ((avgTokensBefore - avgTokensAfter) / avgTokensBefore) * 100 : 0;
  return { summary: { sessions, totalCalls, avgTokensBefore, avgTokensAfter, avgSavingsPct }, lines };
};

export const computeSessionTokens = (
  tools: ToolDefinition[],
  exposed: ToolDefinition[],
  descriptionBudget = DEFAULT_DESCRIPTION_BUDGET
): { tokensBefore: number; tokensAfter: number } => {
  const tokensBefore = tools.reduce((sum, tool) => sum + toolTokenCount(tool), 0);
  const tokensAfter = exposed.reduce((sum, tool) => {
    const compressed = compressTool(tool, descriptionBudget);
    return sum + compressed.tokensAfter;
  }, 0);
  return { tokensBefore, tokensAfter };
};

export const statsFilePath = (): string => join(statsDir(), "stats.jsonl");

export const configDir = dirname(statsDir());
