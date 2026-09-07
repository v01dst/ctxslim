import { describe, expect, it } from "vitest";
import { matchGlob, matchesAny } from "../src/glob.js";

describe("matchGlob", () => {
  it("matches exact strings", () => {
    expect(matchGlob("browser_navigate", "browser_navigate")).toBe(true);
    expect(matchGlob("browser_navigate", "browser_click")).toBe(false);
  });

  it("matches * wildcard", () => {
    expect(matchGlob("browser_*", "browser_navigate")).toBe(true);
    expect(matchGlob("browser_*", "page_navigate")).toBe(false);
    expect(matchGlob("*_debug", "server_debug")).toBe(true);
    expect(matchGlob("*", "anything")).toBe(true);
  });

  it("matches ? wildcard", () => {
    expect(matchGlob("tool_?", "tool_1")).toBe(true);
    expect(matchGlob("tool_?", "tool_12")).toBe(false);
  });

  it("escapes regex metacharacters", () => {
    expect(matchGlob("a.b", "a.b")).toBe(true);
    expect(matchGlob("a.b", "axb")).toBe(false);
    expect(matchGlob("a+b", "a+b")).toBe(true);
  });
});

describe("matchesAny", () => {
  it("returns true when any pattern matches", () => {
    expect(matchesAny(["browser_*", "page_*"], "page_click")).toBe(true);
    expect(matchesAny(["browser_*", "page_*"], "server_tool")).toBe(false);
  });

  it("returns false for empty patterns", () => {
    expect(matchesAny([], "anything")).toBe(false);
  });
});
