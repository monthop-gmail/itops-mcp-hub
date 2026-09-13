const THAI = /[\u0E00-\u0E7F]/;

export function indexTokens(text: string): string[] {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  for (const word of lower.match(/[a-z0-9]{2,}/g) ?? []) {
    out.add(`w:${word}`);
  }
  const compact = lower.replace(/\s+/g, "");
  const chars = [...compact];
  for (let i = 0; i < chars.length - 1; i += 1) {
    const a = chars[i] ?? "";
    const b = chars[i + 1] ?? "";
    if (THAI.test(a) || THAI.test(b)) {
      out.add(`g:${a}${b}`);
    }
  }
  return [...out];
}

export function queryTokens(query: string): string[] {
  return indexTokens(query);
}

export function excerptAround(text: string, query: string, width = 220): string {
  const hay = text.replace(/\s+/g, " ").trim();
  if (!hay) {
    return "";
  }
  const needle = query.trim();
  let idx = needle ? hay.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (idx < 0) {
    const compactQ = needle.replace(/\s+/g, "");
    idx = compactQ ? hay.indexOf(compactQ) : -1;
  }
  if (idx < 0) {
    return hay.slice(0, width * 2);
  }
  const start = Math.max(0, idx - width);
  const end = Math.min(hay.length, idx + needle.length + width);
  return `${start > 0 ? "…" : ""}${hay.slice(start, end)}${end < hay.length ? "…" : ""}`;
}
