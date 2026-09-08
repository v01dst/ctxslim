export type ModelPrice = {
  family: string;
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M?: number;
  cacheWritePer1M?: number;
};

export const PRICE_AS_OF = "2026-09-08";

export const PRICE_TABLE: ModelPrice[] = [
  { family: "claude-fable-5-1", inputPer1M: 10, outputPer1M: 50, cacheReadPer1M: 0.25, cacheWritePer1M: 12.5 },
  { family: "claude-opus-5", inputPer1M: 5, outputPer1M: 25, cacheReadPer1M: 0.5, cacheWritePer1M: 6.25 },
  { family: "claude-sonnet-5", inputPer1M: 2, outputPer1M: 10, cacheReadPer1M: 0.2, cacheWritePer1M: 2.5 },
  { family: "claude-haiku-4-5", inputPer1M: 1, outputPer1M: 5, cacheReadPer1M: 0.1, cacheWritePer1M: 1.25 },
  { family: "gpt-6-astra", inputPer1M: 10, outputPer1M: 50, cacheReadPer1M: 1, cacheWritePer1M: 12.5 },
  { family: "gpt-5.6-sol", inputPer1M: 4, outputPer1M: 20, cacheReadPer1M: 0.4, cacheWritePer1M: 5 },
  { family: "gpt-5.6-terra", inputPer1M: 2, outputPer1M: 12, cacheReadPer1M: 0.2, cacheWritePer1M: 2.5 },
  { family: "gpt-5.6-luna", inputPer1M: 0.2, outputPer1M: 1.2, cacheReadPer1M: 0.02, cacheWritePer1M: 0.25 },
  { family: "gemini-3.1-pro", inputPer1M: 2, outputPer1M: 12, cacheReadPer1M: 0.2 },
  { family: "gemini-3.8-flash", inputPer1M: 0.75, outputPer1M: 3.75, cacheReadPer1M: 0.075 },
];

export const dollarsFor = (tokens: number, ratePer1M: number): number => (tokens * ratePer1M) / 1_000_000;

export const familyNames = (table: ModelPrice[]): string[] => table.map((row) => row.family);

const isPriceRow = (value: unknown): value is ModelPrice => {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
  const optionalPositive = (v: unknown): boolean => v === undefined || positive(v);
  return (
    typeof row.family === "string" &&
    row.family.length > 0 &&
    positive(row.inputPer1M) &&
    positive(row.outputPer1M) &&
    optionalPositive(row.cacheReadPer1M) &&
    optionalPositive(row.cacheWritePer1M)
  );
};

export const parsePricesFile = (raw: unknown): ModelPrice[] => {
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isPriceRow)) {
    throw new Error("prices file must be a non-empty array of { family, inputPer1M, outputPer1M } with positive rates");
  }
  return raw.map((row) => ({ ...row }));
};
