const marker = (omitted: number): string =>
  `\n\n[ctxslim: truncated ${omitted} chars — raise output.maxChars in ctxslim.json to see more]`;

export const truncateOutput = (text: string, maxChars: number): string => {
  if (maxChars <= 0 || text.length <= maxChars) return text;
  const note = marker(text.length - maxChars);
  const body = maxChars - note.length;
  if (body < 200) {
    return `${text.slice(0, maxChars)}${note}`;
  }
  const head = Math.floor(body * 0.7);
  const tail = body - head;
  return `${text.slice(0, head)}${note}${text.slice(text.length - tail)}`;
};

export const compressToolResult = (result: unknown, maxChars: number): { result: unknown; truncated: boolean } => {
  let truncated = false;
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      const next: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        next[key] = walk(child);
      }
      return next;
    }
    if (typeof value === "string" && value.length > maxChars) {
      truncated = true;
      return truncateOutput(value, maxChars);
    }
    return value;
  };
  return { result: walk(result), truncated };
};
