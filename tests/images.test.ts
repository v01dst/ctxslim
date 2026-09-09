import { describe, expect, it, vi } from "vitest";
import { DEFAULT_IMAGE_SPEC, loadImageEngine, processImages, resolveImageSpec } from "../src/images.js";
import type { ImageEngine } from "../src/images.js";

const fakeEngine: ImageEngine = async (data) => ({ data: Buffer.from(`small:${data.length}`), mimeType: "image/jpeg" });
const img = (text: string) => ({ type: "image", data: Buffer.from(text).toString("base64"), mimeType: "image/png" });

describe("resolveImageSpec", () => {
  it("applies defaults", () => {
    expect(resolveImageSpec({})).toEqual({ scale: 0.5, format: "jpeg", quality: 70 });
    expect(resolveImageSpec({ scale: 0.25, format: "png", quality: 90 })).toEqual({ scale: 0.25, format: "png", quality: 90 });
  });

  it("exposes matching defaults constant", () => {
    expect(DEFAULT_IMAGE_SPEC).toEqual(resolveImageSpec({}));
  });
});

describe("processImages", () => {
  it("transforms image items and keeps other fields", () => {
    const input = { content: [{ type: "text", text: "hi" }, { ...img("pixels"), extra: 1 }] };
    return processImages(input, DEFAULT_IMAGE_SPEC, fakeEngine, () => undefined).then(({ result, processed }) => {
      expect(processed).toBe(true);
      const content = (result as { content: Record<string, unknown>[] }).content;
      expect(content[0]).toEqual({ type: "text", text: "hi" });
      expect(content[1]).toMatchObject({ type: "image", mimeType: "image/jpeg", extra: 1 });
      expect(content[1]?.data).not.toBe((input.content[1] as Record<string, unknown>).data);
    });
  });

  it("leaves text-only results untouched", () => {
    const input = { content: [{ type: "text", text: "hi" }] };
    return processImages(input, DEFAULT_IMAGE_SPEC, fakeEngine, () => undefined).then(({ result, processed }) => {
      expect(processed).toBe(false);
      expect(result).toEqual(input);
    });
  });

  it("passes the item through and warns when the engine throws", async () => {
    const warn = vi.fn();
    const failing: ImageEngine = async () => {
      throw new Error("boom");
    };
    const input = { content: [img("pixels")] };
    const { result, processed } = await processImages(input, DEFAULT_IMAGE_SPEC, failing, warn);
    expect(processed).toBe(false);
    expect(result).toEqual(input);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("passes through identical with null engine", async () => {
    const input = { content: [img("pixels")] };
    const { result, processed } = await processImages(input, DEFAULT_IMAGE_SPEC, null, () => undefined);
    expect(processed).toBe(false);
    expect(result).toBe(input);
  });
});

describe("loadImageEngine", () => {
  it("returns null when sharp is not installed", async () => {
    await expect(loadImageEngine()).resolves.toBeNull();
  });
});
