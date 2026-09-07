import type { ToolDefinition } from "./types.js";

export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

const DROP_KEYS = new Set(["$schema", "$id", "title", "examples", "$comment", "const"]);

const RECURSIVE_KEYS = ["properties", "items", "additionalProperties", "anyOf", "oneOf", "allOf", "prefixItems"];

export const truncateWords = (text: string, max: number): string => {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.5 ? cut.slice(0, space) : cut).trimEnd();
};

const collectRefs = (value: unknown, found: Set<string>): void => {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, found);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" && typeof child === "string") {
        const match = child.match(/^#\/\$defs\/([^/"]+)/);
        if (match?.[1]) found.add(match[1]);
      } else {
        collectRefs(child, found);
      }
    }
  }
};

const isEmptyObject = (value: unknown): boolean =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;

const collapseSingle = (value: Record<string, unknown>): Record<string, unknown> => {
  for (const key of ["allOf", "oneOf", "anyOf"]) {
    const arr = value[key];
    if (Array.isArray(arr) && arr.length === 1 && Object.keys(value).length === 1) {
      return collapseSingle(arr[0] as Record<string, unknown>);
    }
  }
  return value;
};

const compressNode = (node: unknown, depth: number, maxDepth: number): unknown => {
  if (depth > maxDepth) return undefined;
  if (Array.isArray(node)) {
    const mapped = node.map((item) => compressNode(item, depth + 1, maxDepth));
    return mapped.filter((item) => item !== undefined);
  }
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return typeof node === "string" || typeof node === "number" || typeof node === "boolean" ? node : undefined;
  }
  const source = collapseSingle(node as Record<string, unknown>);
  const result: Record<string, unknown> = {};
  const entries = Object.entries(source).sort(([a], [b]) => keyOrder(a) - keyOrder(b));
  for (const [key, value] of entries) {
    if (DROP_KEYS.has(key)) continue;
    if (key === "description" && typeof value === "string") {
      const trimmed = truncateWords(value.trim(), 120);
      if (trimmed) result.description = trimmed;
      continue;
    }
    if (key === "$defs" || key === "definitions") {
      const referenced = new Set<string>();
      collectRefs(source, referenced);
      const kept: Record<string, unknown> = {};
      for (const [defName, defValue] of Object.entries(value as Record<string, unknown>)) {
        if (referenced.has(defName)) {
          const compressed = compressNode(defValue, depth + 1, maxDepth);
          if (compressed !== undefined) kept[defName] = compressed;
        }
      }
      if (Object.keys(kept).length > 0) result[key] = kept;
      continue;
    }
    if (RECURSIVE_KEYS.includes(key)) {
      const compressed = compressNode(value, depth + 1, maxDepth);
      if (compressed !== undefined && !isEmptyObject(compressed)) result[key] = compressed;
      continue;
    }
    if (value === null || value === undefined || value === false || value === "") continue;
    if (typeof value === "object" && !Array.isArray(value) && isEmptyObject(value)) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    result[key] = value;
  }
  return Object.keys(result).length === 1 && result.type === "object" ? { type: "object" } : result;
};

const KEY_ORDER: Record<string, number> = { type: 0, description: 1, required: 2, properties: 3 };

const keyOrder = (key: string): number => KEY_ORDER[key] ?? 50;

export type CompressionResult = {
  tool: ToolDefinition;
  tokensBefore: number;
  tokensAfter: number;
};

export const toolTokenCount = (tool: ToolDefinition): number =>
  estimateTokens(JSON.stringify({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }));

export const compressTool = (
  tool: ToolDefinition,
  descriptionBudget: number,
  maxDepth = 6
): CompressionResult => {
  const tokensBefore = toolTokenCount(tool);
  const inputSchema = compressNode(tool.inputSchema, 0, maxDepth) as Record<string, unknown>;
  const slimmed: ToolDefinition = {
    name: tool.name,
    description: tool.description ? truncateWords(tool.description.trim(), descriptionBudget) : undefined,
    inputSchema: (inputSchema ?? { type: "object" }) as Record<string, unknown>,
  };
  if (!slimmed.description) delete slimmed.description;
  const tokensAfter = toolTokenCount(slimmed);
  return { tool: slimmed, tokensBefore, tokensAfter };
};
