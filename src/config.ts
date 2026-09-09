import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { compressTool, toolTokenCount } from "./compressor.js";
import type { UsageRecord } from "./ranker.js";
import type { AuditRecord, ContextSlimConfig, ServerEntry, SlimConfig, SlimMode, ToolDefinition } from "./types.js";
import { DEFAULT_DESCRIPTION_BUDGET } from "./types.js";

const IS_SLIM = /^(node\/)?(ctxslim|@[\w.-]+\/ctxslim)$/;

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
        ...(Array.isArray(e.include) ? { include: e.include.map(String) } : {}),
        ...(Array.isArray(e.exclude) ? { exclude: e.exclude.map(String) } : {}),
        ...(e.output && typeof e.output === "object" ? { output: e.output as { maxChars?: number } } : {}),
        ...(e.images && typeof e.images === "object" ? { images: e.images as { scale?: number; format?: "jpeg" | "png"; quality?: number } } : {}),
      };
      const output = (mcpServers[name] as { output?: { maxChars?: number } }).output;
      if (output && (typeof output.maxChars !== "number" || output.maxChars <= 0)) {
        throw new Error(`Server "${name}" in ${source} has invalid output.maxChars (must be a positive number)`);
      }
      const images = (mcpServers[name] as { images?: { scale?: number; format?: string; quality?: number } }).images;
      if (images) {
        if (images.scale !== undefined && (typeof images.scale !== "number" || !(images.scale > 0) || images.scale > 1)) {
          throw new Error(`Server "${name}" in ${source} has invalid images.scale (must be a number in (0, 1])`);
        }
        if (images.format !== undefined && images.format !== "jpeg" && images.format !== "png") {
          throw new Error(`Server "${name}" in ${source} has invalid images.format (must be "jpeg" or "png")`);
        }
        if (images.quality !== undefined && (!Number.isInteger(images.quality) || images.quality < 1 || images.quality > 100)) {
          throw new Error(`Server "${name}" in ${source} has invalid images.quality (must be an integer 1-100)`);
        }
      }
    } else if (typeof e.url === "string") {
      mcpServers[name] = {
        url: e.url,
        ...(e.headers && typeof e.headers === "object" ? { headers: e.headers as Record<string, string> } : {}),
        ...(Array.isArray(e.include) ? { include: e.include.map(String) } : {}),
        ...(Array.isArray(e.exclude) ? { exclude: e.exclude.map(String) } : {}),
        ...(e.output && typeof e.output === "object" ? { output: e.output as { maxChars?: number } } : {}),
        ...(e.images && typeof e.images === "object" ? { images: e.images as { scale?: number; format?: "jpeg" | "png"; quality?: number } } : {}),
      };
      const output = (mcpServers[name] as { output?: { maxChars?: number } }).output;
      if (output && (typeof output.maxChars !== "number" || output.maxChars <= 0)) {
        throw new Error(`Server "${name}" in ${source} has invalid output.maxChars (must be a positive number)`);
      }
      const images = (mcpServers[name] as { images?: { scale?: number; format?: string; quality?: number } }).images;
      if (images) {
        if (images.scale !== undefined && (typeof images.scale !== "number" || !(images.scale > 0) || images.scale > 1)) {
          throw new Error(`Server "${name}" in ${source} has invalid images.scale (must be a number in (0, 1])`);
        }
        if (images.format !== undefined && images.format !== "jpeg" && images.format !== "png") {
          throw new Error(`Server "${name}" in ${source} has invalid images.format (must be "jpeg" or "png")`);
        }
        if (images.quality !== undefined && (!Number.isInteger(images.quality) || images.quality < 1 || images.quality > 100)) {
          throw new Error(`Server "${name}" in ${source} has invalid images.quality (must be an integer 1-100)`);
        }
      }
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
    ...(slimRaw.connectTimeout !== undefined ? { connectTimeout: Number(slimRaw.connectTimeout) } : {}),
    ...(slimRaw.stats !== undefined ? { stats: Boolean(slimRaw.stats) } : {}),
    ...(slimRaw.adaptive !== undefined ? { adaptive: Boolean(slimRaw.adaptive) } : {}),
    ...(slimRaw.disclosure !== undefined ? { disclosure: Boolean(slimRaw.disclosure) } : {}),
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
  const envPath = process.env.CTX_SLIM_CONFIG;
  if (envPath) {
    const path = resolve(envPath);
    if (!existsSync(path)) {
      throw new Error(`CTX_SLIM_CONFIG points to a missing file: ${path}`);
    }
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return { config: normalizeConfig(raw, path), source: path, label: "CTX_SLIM_CONFIG" };
  }
  const localPath = join(cwd, "ctxslim.json");
  if (existsSync(localPath)) {
    const raw = JSON.parse(readFileSync(localPath, "utf8"));
    return { config: normalizeConfig(raw, localPath), source: localPath, label: "ctxslim.json" };
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
      "No MCP config found. CtxSlim looked for:",
      ...KNOWN_CLIENT_PATHS(home).map((candidate) => `  - ${candidate.path}`),
      "",
      "Fix it by doing one of:",
      '  1. Run `ctxslim --config /path/to/your/mcp.json`',
      "  2. Create a ctxslim.json in this directory",
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

const statsDir = (): string => process.env.CTX_SLIM_STATS_DIR ?? join(homedir(), ".ctxslim");

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

export const loadStatsSummary = (): { summary: StatsSummary; lines: SessionStats[]; corrupt: number } => {
  const file = join(statsDir(), "stats.jsonl");
  if (!existsSync(file)) return { summary: { sessions: 0, totalCalls: 0, avgTokensBefore: 0, avgTokensAfter: 0, avgSavingsPct: 0 }, lines: [], corrupt: 0 };
  const lines: SessionStats[] = [];
  let corrupt = 0;
  for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    try {
      const parsed: unknown = JSON.parse(line);
      const stats = parsed as Partial<SessionStats> | null;
      if (stats && typeof stats.callsRouted === "number" && typeof stats.tokensBefore === "number" && typeof stats.tokensAfter === "number") {
        lines.push(stats as SessionStats);
      } else {
        corrupt += 1;
      }
    } catch {
      corrupt += 1;
    }
  }
  const sessions = lines.length;
  const totalCalls = lines.reduce((sum, line) => sum + line.callsRouted, 0);
  const avgTokensBefore = sessions ? lines.reduce((sum, line) => sum + line.tokensBefore, 0) / sessions : 0;
  const avgTokensAfter = sessions ? lines.reduce((sum, line) => sum + line.tokensAfter, 0) / sessions : 0;
  const avgSavingsPct = avgTokensBefore > 0 ? ((avgTokensBefore - avgTokensAfter) / avgTokensBefore) * 100 : 0;
  return { summary: { sessions, totalCalls, avgTokensBefore, avgTokensAfter, avgSavingsPct }, lines, corrupt };
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

export const usageFilePath = (): string => join(statsDir(), "usage.json");

export const loadUsageMap = (): Record<string, UsageRecord> => {
  try {
    const file = usageFilePath();
    if (!existsSync(file)) return {};
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const clean: Record<string, UsageRecord> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const record = value as Partial<UsageRecord> | undefined;
      if (typeof record?.count === "number" && typeof record?.lastUsed === "number") {
        clean[key] = { count: record.count, lastUsed: record.lastUsed };
      }
    }
    return clean;
  } catch {
    return {};
  }
};

export const saveUsageMap = (map: Record<string, UsageRecord>): void => {
  try {
    const dir = statsDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(usageFilePath(), JSON.stringify(map));
  } catch {
    return;
  }
};

export const auditFilePath = (): string => join(statsDir(), "audit.jsonl");

export const appendAuditLine = (record: AuditRecord): void => {
  try {
    const dir = statsDir();
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "audit.jsonl"), JSON.stringify(record) + "\n");
  } catch {
    return;
  }
};

const isAuditRecord = (value: unknown): value is AuditRecord => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.ts === "number" &&
    Number.isFinite(record.ts) &&
    typeof record.session === "string" &&
    typeof record.server === "string" &&
    typeof record.tool === "string" &&
    typeof record.argsHash === "string" &&
    typeof record.reqChars === "number" &&
    Number.isFinite(record.reqChars) &&
    typeof record.outChars === "number" &&
    Number.isFinite(record.outChars) &&
    typeof record.isError === "boolean" &&
    typeof record.durationMs === "number" &&
    Number.isFinite(record.durationMs)
  );
};

export const loadAuditRecords = (): { records: AuditRecord[]; corrupt: number } => {
  try {
    const file = auditFilePath();
    if (!existsSync(file)) return { records: [], corrupt: 0 };
    const records: AuditRecord[] = [];
    let corrupt = 0;
    for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
      try {
        const parsed: unknown = JSON.parse(line);
        if (isAuditRecord(parsed)) records.push(parsed);
        else corrupt += 1;
      } catch {
        corrupt += 1;
      }
    }
    return { records, corrupt };
  } catch {
    return { records: [], corrupt: 0 };
  }
};
