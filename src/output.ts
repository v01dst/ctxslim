const marker = (omitted: number): string =>
  `\n\n[ctxslim: truncated ${omitted} chars — raise output.maxChars in ctxslim.json to see more]`;

const compactJsonText = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return text;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return JSON.stringify(parsed);
  } catch {
    return text;
  }
};

export const truncateOutput = (text: string, maxChars: number): string => {
  if (maxChars <= 0 || text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, maxChars);
  const omitted = Math.max(0, text.length - maxChars);
  const fullNote = marker(omitted);
  const note = fullNote.length < maxChars ? fullNote : `… [${omitted} chars omitted]`;
  const body = maxChars - note.length;
  if (body <= 0) return text.slice(0, maxChars);
  if (body < 40) return `${text.slice(0, body)}${note}`.slice(0, maxChars);
  const head = Math.ceil(body * 0.7);
  const tail = body - head;
  return `${text.slice(0, head)}${note}${text.slice(text.length - tail)}`;
};

export const compressToolResult = (result: unknown, maxChars: number): { result: unknown; truncated: boolean } => {
  let truncated = false;
  const processItems = (items: unknown[]): unknown[] => items.map(processItem);
  const processItem = (item: unknown): unknown => {
    if (Array.isArray(item)) return processItems(item);
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const next: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(obj)) {
        if (key === "text" && obj.type === "text" && typeof child === "string") {
          const compacted = compactJsonText(child);
          const candidate = compacted.length < child.length ? compacted : child;
          if (candidate.length > maxChars) {
            truncated = true;
            next[key] = truncateOutput(candidate, maxChars);
          } else {
            next[key] = candidate;
          }
        } else if (key === "content" && Array.isArray(child)) {
          next[key] = processItems(child);
        } else {
          next[key] = child;
        }
      }
      return next;
    }
    return item;
  };
  const processRoot = (value: unknown): unknown => {
    if (Array.isArray(value)) return processItems(value);
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (Array.isArray(obj.content)) {
        return { ...obj, content: processItems(obj.content as unknown[]) };
      }
      return value;
    }
    return value;
  };
  return { result: processRoot(result), truncated };
};
