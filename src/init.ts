import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export type InitTarget = {
  path: string;
  label: string;
  serversKey: string | null;
};

export const KNOWN_INIT_TARGETS = (home: string): InitTarget[] => [
  { path: join(home, ".claude", "claude_desktop_config.json"), label: "claude-desktop", serversKey: null },
  { path: join(home, ".config", "Claude", "claude_desktop_config.json"), label: "claude-desktop", serversKey: null },
  { path: join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"), label: "claude-desktop", serversKey: null },
  { path: join(home, ".cursor", "mcp.json"), label: "cursor", serversKey: null },
  { path: join(home, ".codeium", "windsurf", "mcp_config.json"), label: "windsurf", serversKey: null },
  { path: join(home, ".config", "Code", "User", "mcp.json"), label: "vscode", serversKey: "servers" },
  { path: join(home, ".claude.json"), label: "claude-code", serversKey: null },
];

export const SLIM_ENTRY = { command: "npx", args: ["-y", "ctxslim"] };

export const resolveTarget = (client: string | undefined): InitTarget | undefined => {
  if (!client) return undefined;
  const home = homedir();
  const byLabel = KNOWN_INIT_TARGETS(home).find((target) => target.label === client.replace(/^\.?\//, "").toLowerCase());
  if (byLabel) return byLabel;
  return { path: client, label: basename(client), serversKey: null };
};

export const existingTargets = (): InitTarget[] => [...new Map(KNOWN_INIT_TARGETS(homedir()).filter((target) => existsSync(target.path)).map((target) => [target.path, target])).values()];

export type InitPlan = {
  target: InitTarget;
  exists: boolean;
  serverCount: number;
  alreadyInstalled: boolean;
  error: string | null;
};

const countServers = (raw: Record<string, unknown>, serversKey: string | null): number => {
  const servers = serversKey ? raw[serversKey] : (raw as Record<string, unknown>).mcpServers ?? raw.servers;
  return servers && typeof servers === "object" ? Object.keys(servers as object).length : 0;
};

export const planInit = (target: InitTarget): InitPlan => {
  if (!existsSync(target.path)) {
    return { target, exists: false, serverCount: 0, alreadyInstalled: false, error: null };
  }
  try {
    const raw = JSON.parse(readFileSync(target.path, "utf8")) as Record<string, unknown>;
    const servers = target.serversKey ? raw[target.serversKey] : (raw.mcpServers ?? raw.servers);
    const installed =
      servers && typeof servers === "object" && Object.keys(servers as object).some((name) => name === "ctxslim" || name === "context-slim");
    return {
      target,
      exists: true,
      serverCount: countServers(raw, target.serversKey),
      alreadyInstalled: Boolean(installed),
      error: null,
    };
  } catch (err) {
    return { target, exists: true, serverCount: 0, alreadyInstalled: false, error: err instanceof Error ? err.message : String(err) };
  }
};

export type InitResult = { ok: boolean; message: string; backupPath?: string };

export const applyInit = (target: InitTarget, now = new Date()): InitResult => {
  let raw: Record<string, unknown> = {};
  if (existsSync(target.path)) {
    try {
      raw = JSON.parse(readFileSync(target.path, "utf8")) as Record<string, unknown>;
    } catch (err) {
      return { ok: false, message: `${target.path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  const backupPath = `${target.path}.bak-ctxslim-${now.toISOString().replace(/[:.]/g, "-")}`;
  if (existsSync(target.path)) copyFileSync(target.path, backupPath);
  const serversKey = target.serversKey ?? "mcpServers";
  const servers = raw[serversKey] && typeof raw[serversKey] === "object" ? (raw[serversKey] as Record<string, unknown>) : {};
  for (const name of ["ctxslim", "context-slim"]) delete servers[name];
  servers.ctxslim = SLIM_ENTRY;
  raw[serversKey] = servers;
  try {
    writeFileSync(target.path, JSON.stringify(raw, null, 2) + "\n");
  } catch (err) {
    return { ok: false, message: `Failed to write ${target.path}: ${err instanceof Error ? err.message : String(err)}` };
  }
  return {
    ok: true,
    message: [
      `Wrote the ctxslim proxy entry into ${target.path}`,
      `${existsSync(backupPath) ? `backup saved to ${backupPath}` : "created new file"}`,
      `restart your client to pick it up`,
    ].join("\n"),
    backupPath,
  };
};
