import { describe, expect, it } from "vitest";
import { compressTool, estimateTokens, toolTokenCount, truncateWords } from "../src/compressor.js";
import type { ToolDefinition } from "../src/types.js";

const fatTool = (): ToolDefinition => ({
  name: "database_query",
  description:
    "Execute a SQL query against the connected PostgreSQL database. Results are returned as JSON rows. Supports parameterized queries and read-only transactions. Retries transient connection failures up to three times before surfacing an error to the caller with full diagnostics.",
  inputSchema: {
    type: "object",
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Query parameters",
    properties: {
      sql: { type: "string", description: "The SQL statement to execute. Must be a valid PostgreSQL statement.", examples: ["SELECT 1"] },
      params: { type: "array", items: { type: "string" }, description: "Bind parameters for the query." },
      timeout: { type: "number", description: "Query timeout in milliseconds.", default: 30000 },
    },
    required: ["sql"],
    $defs: {
      Unused: { type: "object", properties: { never: { type: "string" } } },
    },
  },
});

describe("truncateWords", () => {
  it("returns short strings untouched", () => {
    expect(truncateWords("hello world", 100)).toBe("hello world");
  });

  it("truncates on a word boundary", () => {
    const result = truncateWords("alpha beta gamma delta epsilon", 15);
    expect(result.length).toBeLessThanOrEqual(15);
    expect(result.endsWith(" ")).toBe(false);
    expect(result.split(" ").length).toBeGreaterThan(1);
  });

  it("returns empty for zero budget", () => {
    expect(truncateWords("anything", 0)).toBe("");
  });
});

describe("estimateTokens", () => {
  it("is chars/4 rounded up", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });
});

describe("compressTool", () => {
  it("reduces token count", () => {
    const result = compressTool(fatTool(), 280);
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
  });

  it("drops useless schema keywords", () => {
    const { tool } = compressTool(fatTool(), 280);
    expect(tool.inputSchema.$schema).toBeUndefined();
    expect(tool.inputSchema.title).toBeUndefined();
    expect(tool.inputSchema.$defs).toBeUndefined();
  });

  it("keeps required properties and structure", () => {
    const { tool } = compressTool(fatTool(), 280);
    expect(tool.inputSchema.required).toEqual(["sql"]);
    const properties = tool.inputSchema.properties as Record<string, unknown>;
    expect(Object.keys(properties)).toContain("sql");
  });

  it("respects description budget", () => {
    const { tool } = compressTool(fatTool(), 40);
    expect((tool.description ?? "").length).toBeLessThanOrEqual(45);
  });

  it("preserves $defs that are actually referenced", () => {
    const tool: ToolDefinition = {
      name: "ref_tool",
      inputSchema: {
        type: "object",
        properties: { item: { $ref: "#/$defs/Item" } },
        $defs: {
          Item: { type: "object", properties: { id: { type: "string" } } },
          Ghost: { type: "object", properties: { x: { type: "string" } } },
        },
      },
    };
    const { tool: compressed } = compressTool(tool, 280);
    const defs = compressed.inputSchema.$defs as Record<string, unknown> | undefined;
    expect(defs).toBeDefined();
    expect(Object.keys(defs ?? {})).toEqual(["Item"]);
  });

  it("collapses single-entry allOf", () => {
    const tool: ToolDefinition = {
      name: "allof_tool",
      inputSchema: { allOf: [{ type: "object", properties: { a: { type: "string" } } }] },
    };
    const { tool: compressed } = compressTool(tool, 280);
    expect(compressed.inputSchema.allOf).toBeUndefined();
    expect((compressed.inputSchema.properties as Record<string, unknown>).a).toBeDefined();
  });

  it("toolTokenCount is stable before and after", () => {
    const tool = fatTool();
    const direct = toolTokenCount(tool);
    const { tokensBefore } = compressTool(tool, 280);
    expect(tokensBefore).toBe(direct);
  });
});
