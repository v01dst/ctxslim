import { createInterface } from "node:readline";

const [serverName = "fake", toolCountArg = "6"] = process.argv.slice(2);
const toolCount = Number(toolCountArg);

const bigDescription =
  "This tool performs a comprehensive operation on the target resource. " +
  "It validates all inputs against the schema, retries transient failures with exponential backoff, " +
  "and emits structured audit events for every mutation it performs. " +
  "Use this tool when you need guaranteed durability and observability. " +
  "Do not use this tool for read-only explorations; use the lightweight variant instead.";

const fatSchema = (index) => ({
  type: "object",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: `Schema for ${serverName} tool ${index}`,
  properties: {
    id: {
      type: "string",
      description: "The unique identifier of the target resource. Must be a UUID v4 string.",
      examples: ["123e4567-e89b-12d3-a456-426614174000"],
      pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    },
    query: { type: "string", description: "Free-text query to filter the results before they are returned.", examples: ["status:active"] },
    limit: { type: "number", description: "Maximum number of items to return in a single page of results.", default: 20 },
    options: {
      type: "object",
      title: "Options",
      properties: {
        sort: { type: "string", enum: ["asc", "desc"], description: "Sort direction for the returned items." },
        include: { type: "array", items: { type: "string" }, description: "Related resources to include in the response." },
        retry: { type: "boolean", description: "Whether to retry the operation if it fails transiently.", default: true },
      },
    },
    record: { $ref: "#/$defs/Record" },
  },
  required: ["id"],
  additionalProperties: false,
  $defs: {
    Record: {
      type: "object",
      title: "A nested record",
      properties: {
        key: { type: "string", description: "Record key." },
        payload: { type: "string", description: "Opaque payload string stored with the record." },
      },
    },
    Unused: { type: "object", properties: { never: { type: "string" } } },
  },
});

const tools = [
  ...Array.from({ length: toolCount }, (_, index) => ({
    name: `${serverName}_tool_${index}`,
    description: `${bigDescription} Tool ${index} of server ${serverName}.`,
    inputSchema: fatSchema(index),
  })),
  {
    name: `${serverName}_tool_0__big`,
    description: `${bigDescription} Big-output variant of tool 0 of server ${serverName}.`,
    inputSchema: fatSchema(0),
  },
];

const reply = (id, result) => {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
};

const replyError = (id, code, message) => {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
};

const handle = (message) => {
  if (!message || message.jsonrpc !== "2.0" || message.id === undefined || message.id === null) return;
  switch (message.method) {
    case "initialize":
      reply(message.id, {
        protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {}, prompts: {}, resources: {} },
        serverInfo: { name: serverName, version: "1.0.0" },
      });
      break;
    case "tools/list":
      reply(message.id, { tools });
      break;
    case "tools/call": {
      const name = message.params?.name ?? "unknown";
      if (message.params?.arguments?.fail === true) {
        replyError(message.id, -32000, "fake failure");
        break;
      }
      const text = name.endsWith("__big")
        ? `TRUNCATION-SENTINEL${"payload ".repeat(4000)}END-SENTINEL`
        : `${serverName} handled ${name}`;
      reply(message.id, { content: [{ type: "text", text }] });
      break;
    }
    case "prompts/list":
      reply(message.id, { prompts: [] });
      break;
    case "resources/list":
      reply(message.id, { resources: [] });
      break;
    case "resources/templates/list":
      reply(message.id, { resourceTemplates: [] });
      break;
    case "ping":
      reply(message.id, {});
      break;
    default:
      replyError(message.id, -32601, `Method not found: ${message.method}`);
  }
};

const readline = createInterface({ input: process.stdin });
readline.on("line", (line) => {
  if (!line.trim()) return;
  try {
    handle(JSON.parse(line));
  } catch {
    return;
  }
});
readline.on("close", () => process.exit(0));
