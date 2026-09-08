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
  const processItems = (items: unknown[]): unknown[] => items.map(processItem);
  const processItem = (item: unknown): unknown => {
    if (Array.isArray(item)) return processItems(item);
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const next: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(obj)) {
        if (key === "text" && obj.type === "text" && typeof child === "string" && child.length > maxChars) {
          truncated = true;
          next[key] = truncateOutput(child, maxChars);
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
