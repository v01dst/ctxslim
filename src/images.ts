export type ImageSpec = {
  scale?: number;
  format?: "jpeg" | "png";
  quality?: number;
};

export type ResolvedImageSpec = {
  scale: number;
  format: "jpeg" | "png";
  quality: number;
};

export const DEFAULT_IMAGE_SPEC: ResolvedImageSpec = { scale: 0.5, format: "jpeg", quality: 70 };

export const resolveImageSpec = (spec: ImageSpec): ResolvedImageSpec => ({
  scale: spec.scale ?? DEFAULT_IMAGE_SPEC.scale,
  format: spec.format ?? DEFAULT_IMAGE_SPEC.format,
  quality: spec.quality ?? DEFAULT_IMAGE_SPEC.quality,
});

export type ImageEngine = (data: Buffer, spec: ResolvedImageSpec) => Promise<{ data: Buffer; mimeType: string }>;

type SharpInstance = {
  metadata: () => Promise<{ width?: number; height?: number }>;
  resize: (opts: { width?: number; height?: number; fit: string; withoutEnlargement: boolean }) => SharpInstance;
  jpeg: (opts: { quality: number }) => SharpInstance;
  png: (opts: { quality: number }) => SharpInstance;
  toBuffer: () => Promise<Buffer>;
};

export const loadImageEngine = async (): Promise<ImageEngine | null> => {
  try {
    const mod = (await import("sharp")) as unknown as { default: (input: Buffer) => SharpInstance };
    const sharp = mod.default;
    return async (data, spec) => {
      const image = sharp(data);
      const meta = await image.metadata();
      const width = meta.width ? Math.max(1, Math.floor(meta.width * spec.scale)) : undefined;
      const height = meta.width ? undefined : meta.height ? Math.max(1, Math.floor(meta.height * spec.scale)) : undefined;
      const resized = image.resize({ width, height, fit: "inside", withoutEnlargement: true });
      const encoded = spec.format === "png" ? resized.png({ quality: spec.quality }) : resized.jpeg({ quality: spec.quality });
      const out = await encoded.toBuffer();
      return { data: out, mimeType: spec.format === "png" ? "image/png" : "image/jpeg" };
    };
  } catch {
    return null;
  }
};

export const processImages = async (
  result: unknown,
  spec: ResolvedImageSpec,
  engine: ImageEngine | null,
  onWarn: (message: string) => void
): Promise<{ result: unknown; processed: boolean }> => {
  if (!engine) return { result, processed: false };
  let processed = false;
  const processItems = async (items: unknown[]): Promise<unknown[]> => {
    const out: unknown[] = [];
    for (const item of items) out.push(await processItem(item));
    return out;
  };
  const processItem = async (item: unknown): Promise<unknown> => {
    if (Array.isArray(item)) return processItems(item);
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      if (obj.type === "image" && typeof obj.data === "string") {
        try {
          const out = await engine(Buffer.from(obj.data, "base64"), spec);
          processed = true;
          return { ...obj, data: out.data.toString("base64"), mimeType: out.mimeType };
        } catch (err) {
          onWarn(`image transform failed, passing through unchanged: ${err instanceof Error ? err.message : String(err)}`);
          return item;
        }
      }
      if (Array.isArray(obj.content)) {
        return { ...obj, content: await processItems(obj.content as unknown[]) };
      }
      return item;
    }
    return item;
  };
  if (Array.isArray(result)) return { result: await processItems(result), processed };
  if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (Array.isArray(obj.content)) {
      return { result: { ...obj, content: await processItems(obj.content as unknown[]) }, processed };
    }
  }
  return { result, processed };
};
