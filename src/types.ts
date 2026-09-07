export type StdioServerEntry = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export type HttpServerEntry = {
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
  stats?: boolean;
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
