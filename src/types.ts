export type ServerEntryBase = {
  include?: string[];
  exclude?: string[];
  output?: { maxChars?: number };
  images?: { scale?: number; format?: "jpeg" | "png"; quality?: number };
};

export type StdioServerEntry = ServerEntryBase & {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export type HttpServerEntry = ServerEntryBase & {
  url: string;
  headers?: Record<string, string>;
};

export type ServerEntry = StdioServerEntry | HttpServerEntry;

export type SlimMode = "auto" | "manual" | "off";

export type SlimConfig = {
  mode?: SlimMode;
  maxTools?: number;
  pins?: string[];
  allowlist?: string[];
  descriptionBudget?: number;
  connectTimeout?: number;
  stats?: boolean;
  adaptive?: boolean;
  disclosure?: boolean;
};

export type ContextSlimConfig = {
  mcpServers: Record<string, ServerEntry>;
  slim?: SlimConfig;
};

export type ToolDefinition = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  [key: string]: unknown;
};

export const isStdioEntry = (entry: ServerEntry): entry is StdioServerEntry =>
  typeof (entry as StdioServerEntry).command === "string";

export const DEFAULT_MAX_TOOLS = 24;
export const DEFAULT_DESCRIPTION_BUDGET = 280;

export type AuditRecord = {
  ts: number;
  session: string;
  server: string;
  tool: string;
  argsHash: string;
  reqChars: number;
  outChars: number;
  isError: boolean;
  durationMs: number;
};
