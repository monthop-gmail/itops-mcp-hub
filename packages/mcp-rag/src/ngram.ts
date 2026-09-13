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
    for (const part of needle.split(/\s+/).filter((term) => [...term].length >= 2)) {
      idx = hay.toLowerCase().indexOf(part.toLowerCase());
      if (idx >= 0) {
        break;
      }
    }
  }
  if (idx < 0) {
    return hay.slice(0, width * 2);
  }
  const start = Math.max(0, idx - width);
  const end = Math.min(hay.length, idx + Math.max(needle.length, 2) + width);
  return `${start > 0 ? "…" : ""}${hay.slice(start, end)}${end < hay.length ? "…" : ""}`;
}
