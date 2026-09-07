import { describe, expect, it } from "vitest";
import { ToolIndex, tokenize, usageScore } from "../src/ranker.js";
import type { ToolDefinition } from "../src/types.js";

const tool = (name: string, description: string, properties: string[] = []): ToolDefinition => ({
  name,
  description,
  inputSchema: {
    type: "object",
    properties: Object.fromEntries(properties.map((prop) => [prop, { type: "string" }])),
  },
});

const entries = [
  { key: "a::query_database", tool: tool("query_database", "Run SQL queries against PostgreSQL", ["sql", "params"]), server: "a" },
  { key: "a::insert_row", tool: tool("insert_row", "Insert a row into a database table", ["table", "row"]), server: "a" },
  { key: "b::send_email", tool: tool("send_email", "Send an email via SMTP to a recipient", ["to", "subject", "body"]), server: "b" },
  { key: "b::list_files", tool: tool("list_files", "List files in a directory on the filesystem", ["path"]), server: "b" },
];

describe("tokenize", () => {
  it("splits camelCase and lowercases", () => {
    expect(tokenize("queryDatabase")).toEqual(["query", "database"]);
  });

  it("drops stopwords and single chars", () => {
    expect(tokenize("a tool for the database")).toEqual(["database"]);
  });
});

describe("ToolIndex", () => {
  it("ranks exact name matches highest", () => {
    const index = new ToolIndex();
    index.rebuild(entries);
    const hits = index.search("send email", 3);
    expect(hits[0]?.key).toBe("b::send_email");
  });

  it("finds database tools for database query", () => {
    const index = new ToolIndex();
    index.rebuild(entries);
    const hits = index.search("query the database", 2);
    expect(hits[0]?.key).toBe("a::query_database");
    expect(hits.every((hit) => hit.key !== "b::send_email")).toBe(true);
  });

  it("returns empty for nonsense", () => {
    const index = new ToolIndex();
    index.rebuild(entries);
    expect(index.search("zzzqqq", 3)).toEqual([]);
  });

  it("respects limit", () => {
    const index = new ToolIndex();
    index.rebuild(entries);
    expect(index.search("database table row email files", 1)).toHaveLength(1);
  });

  it("property names contribute to matching", () => {
    const index = new ToolIndex();
    index.rebuild(entries);
    const hits = index.search("smtp recipient", 2);
    expect(hits[0]?.key).toBe("b::send_email");
  });
});

describe("usageScore", () => {
  it("is zero without history", () => {
    expect(usageScore(undefined, Date.now())).toBe(0);
  });

  it("decays with age", () => {
    const now = Date.now();
    const fresh = usageScore({ count: 1, lastUsed: now }, now);
    const old = usageScore({ count: 1, lastUsed: now - 60 * 60 * 1000 }, now);
    expect(fresh).toBeGreaterThan(old);
    expect(old).toBeGreaterThanOrEqual(0);
  });

  it("grows with frequency up to a cap", () => {
    const now = Date.now();
    const once = usageScore({ count: 1, lastUsed: now }, now);
    const many = usageScore({ count: 100, lastUsed: now }, now);
    expect(many).toBeGreaterThan(once);
    expect(many).toBeLessThan(once + 10);
  });
});
