import type { ToolDefinition } from "./types.js";

export type MetaToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export const META_TOOLS: MetaToolDefinition[] = [
  {
    name: "search_tools",
    description:
      "Search all connected MCP servers for tools matching a task. Returns tool names, descriptions and argument schemas. Call this before assuming a tool is unavailable.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What the task needs, e.g. 'query postgres database' or 'edit file'" },
        limit: { type: "number", description: "Maximum number of tools to return (default 8, max 50)" },
      },
      required: ["query"],
    },
  },
  {
    name: "enable_tools",
    description:
      "Keep specific tools exposed for the rest of the session so they stop being swapped out. Pass tool names exactly as returned by search_tools.",
    inputSchema: {
      type: "object",
      properties: {
        tools: { type: "array", items: { type: "string" }, description: "Tool names to pin for this session" },
      },
      required: ["tools"],
    },
  },
  {
    name: "list_servers",
    description: "List the MCP servers behind CtxSlim with their connection status and tool counts.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "slim_stats",
    description: "Report how many tokens CtxSlim saved this session.",
    inputSchema: { type: "object", properties: {} },
  },
];

const isMetaTool = (tool: ToolDefinition): boolean =>
  typeof tool.description === "string" && tool.description.length > 0;

export const formatSearchResults = (
  hits: { name: string; server: string; tool: ToolDefinition }[],
  query: string
): string => {
  if (hits.length === 0) {
    return [
      `No tools matched "${query}".`,
      "Try broader terms, or call list_servers to see what is connected.",
    ].join("\n");
  }
  const blocks = hits.map(({ name, server, tool }) => {
    const schema = JSON.stringify(tool.inputSchema);
    const description = typeof tool.description === "string" ? tool.description : "no description";
    return [`### ${name}`, `server: ${server}`, description, `arguments: ${schema}`].join("\n");
  });
  return [`Found ${hits.length} tool${hits.length === 1 ? "" : "s"} for "${query}":`, "", ...blocks].join("\n\n");
};

export const formatServerList = (
  servers: { name: string; status: string; toolCount: number; transport: string }[]
): string => {
  const rows = servers.map((server) => `  ${server.name.padEnd(24)} ${server.status.padEnd(10)} ${String(server.toolCount).padStart(3)} tools  (${server.transport})`);
  return ["Connected MCP servers:", ...rows].join("\n");
};

export { isMetaTool };
