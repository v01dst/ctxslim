import { describe, expect, it } from "vitest";
import { compressToolResult, truncateOutput } from "../src/output.js";

describe("truncateOutput", () => {
  it("returns short text unchanged", () => {
    expect(truncateOutput("hello", 100)).toBe("hello");
  });

  it("keeps head and tail with a marker", () => {
    const long = `${"a".repeat(3000)}${"MIDDLE".repeat(500)}${"b".repeat(3000)}`;
    const out = truncateOutput(long, 2000);
    expect(out.length).toBeLessThan(2200);
    expect(out.startsWith("a")).toBe(true);
    expect(out.endsWith("b")).toBe(true);
    expect(out).toMatch(/\[ctxslim: truncated \d+ chars/);
  });

  it("caps output length near maxChars", () => {
    const out = truncateOutput("x".repeat(10000), 1500);
    expect(out.length).toBeLessThan(1700);
    expect(out.length).toBeGreaterThanOrEqual(1000);
  });

  it("handles maxChars larger than text", () => {
    expect(truncateOutput("short", 5000)).toBe("short");
  });
});

describe("compressToolResult", () => {
  it("truncates long strings inside content arrays", () => {
    const result = { content: [{ type: "text", text: "y".repeat(9000) }] };
    const { result: compressed, truncated } = compressToolResult(result, 500);
    expect(truncated).toBe(true);
    const text = (compressed as { content: { text: string }[] }).content[0].text;
    expect(text).toContain("[ctxslim: truncated");
    expect(text.length).toBeLessThan(700);
  });

  it("leaves short results untouched", () => {
    const result = { content: [{ type: "text", text: "fine" }] };
    const { result: compressed, truncated } = compressToolResult(result, 500);
    expect(truncated).toBe(false);
    expect(compressed).toEqual(result);
  });
});
