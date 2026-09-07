import type { ToolDefinition } from "./types.js";

const STOPWORDS = new Set([
  "a", "an", "the", "to", "for", "and", "or", "of", "in", "on", "with", "by", "is", "it",
  "this", "that", "use", "using", "used", "when", "from", "your", "you", "if", "as", "at",
  "be", "can", "will", "into", "string", "number", "boolean", "object", "array", "value",
  "values", "optional", "required", "returns", "return", "given", "set", "get", "tool", "tools",
]);

const splitCamel = (term: string): string[] => term.split(/(?<=[a-z0-9])(?=[A-Z])/).map((part) => part.toLowerCase());

export const tokenize = (text: string): string[] => {
  const raw = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1 && !STOPWORDS.has(term) && !/^\d+$/.test(term));
  const expanded: string[] = [];
  for (const term of raw) {
    expanded.push(term);
    if (term.length > 4 && term.length < 20) {
      const parts = splitCamel(term);
      if (parts.length > 1) expanded.push(...parts);
    }
  }
  return expanded;
};

export type IndexedTool = {
  key: string;
  tool: ToolDefinition;
  server: string;
  terms: Map<string, number>;
  length: number;
};

export type SearchHit = {
  key: string;
  score: number;
};

const K1 = 1.2;
const B = 0.75;

export class ToolIndex {
  private docs = new Map<string, IndexedTool>();
  private order: string[] = [];
  private df = new Map<string, number>();
  private avgLength = 1;

  get size(): number {
    return this.docs.size;
  }

  rebuild(entries: { key: string; tool: ToolDefinition; server: string }[]): void {
    this.docs.clear();
    this.order = [];
    this.df.clear();
    for (const entry of entries) {
      const terms = new Map<string, number>();
      const add = (text: string, weight: number): void => {
        for (const term of tokenize(text)) {
          terms.set(term, (terms.get(term) ?? 0) + weight);
        }
      };
      add(entry.tool.name, 3);
      if (entry.tool.title) add(entry.tool.title, 2);
      for (const prop of Object.keys((entry.tool.inputSchema?.properties as object) ?? {})) {
        add(prop, 2);
      }
      if (typeof entry.tool.description === "string") add(entry.tool.description, 1);
      const length = terms.size || 1;
      this.docs.set(entry.key, { key: entry.key, tool: entry.tool, server: entry.server, terms, length });
      this.order.push(entry.key);
    }
    this.avgLength = this.docs.size > 0 ? [...this.docs.values()].reduce((sum, doc) => sum + doc.length, 0) / this.docs.size : 1;
    for (const doc of this.docs.values()) {
      for (const term of doc.terms.keys()) {
        this.df.set(term, (this.df.get(term) ?? 0) + 1);
      }
    }
  }

  private idf(term: string): number {
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (this.docs.size - df + 0.5) / (df + 0.5));
  }

  private bm25(queryTerms: string[], doc: IndexedTool): number {
    let score = 0;
    for (const term of queryTerms) {
      const tf = doc.terms.get(term);
      if (!tf) continue;
      const norm = K1 * (1 - B + B * (doc.length / this.avgLength));
      score += this.idf(term) * ((tf * (K1 + 1)) / (tf + norm));
    }
    return score;
  }

  search(query: string, limit: number): SearchHit[] {
    const queryTerms = [...new Set(tokenize(query))];
    if (queryTerms.length === 0 || this.docs.size === 0) return [];
    const hits: SearchHit[] = [];
    for (const doc of this.docs.values()) {
      const score = this.bm25(queryTerms, doc);
      if (score > 0) hits.push({ key: doc.key, score });
    }
    hits.sort((a, b) => b.score - a.score || this.order.indexOf(a.key) - this.order.indexOf(b.key));
    return hits.slice(0, limit);
  }

  get(key: string): IndexedTool | undefined {
    return this.docs.get(key);
  }

  allKeys(): string[] {
    return [...this.order];
  }
}

export type UsageRecord = { count: number; lastUsed: number };

export const usageScore = (record: UsageRecord | undefined, now: number): number => {
  if (!record) return 0;
  const ageMinutes = Math.max(0, (now - record.lastUsed) / 60000);
  const recency = Math.exp(-ageMinutes / 30);
  const frequency = Math.min(record.count * 0.5, 3);
  return recency * 4 + frequency;
};
