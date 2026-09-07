const escapeRegex = (text: string): string => text.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");

export const matchGlob = (pattern: string, text: string): boolean => {
  const source = escapeRegex(pattern).replace(/\\\*/g, ".*").replace(/\\\?/g, ".");
  return new RegExp(`^${source}$`).test(text);
};

export const matchesAny = (patterns: string[], text: string): boolean => patterns.some((pattern) => matchGlob(pattern, text));
