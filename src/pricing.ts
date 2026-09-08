export type ModelPrice = {
  family: string;
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M?: number;
  cacheWritePer1M?: number;
};

export const PRICE_AS_OF = "2026-09-08";

export const PRICE_TABLE: ModelPrice[] = [
  { family: "sonnet", inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 },
  { family: "opus", inputPer1M: 15, outputPer1M: 75, cacheReadPer1M: 1.5, cacheWritePer1M: 18.75 },
  { family: "gpt", inputPer1M: 2.5, outputPer1M: 10 },
  { family: "gemini", inputPer1M: 1.25, outputPer1M: 10 },
  { family: "gemini-flash", inputPer1M: 0.3, outputPer1M: 2.5 },
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
