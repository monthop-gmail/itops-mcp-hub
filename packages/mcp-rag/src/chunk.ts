export interface TextChunk {
  page: number | null;
  text: string;
}

const CHUNK_SIZE = 1400;
const OVERLAP = 160;

export function chunkText(raw: string): TextChunk[] {
  const pages = raw.includes("\f") ? raw.split("\f") : [raw];
  const out: TextChunk[] = [];
  pages.forEach((pageText, index) => {
    const cleaned = pageText.replace(/\u0000/g, "").trim();
    if (!cleaned) {
      return;
    }
    const page = pages.length > 1 ? index + 1 : null;
    if (cleaned.length <= CHUNK_SIZE) {
      out.push({ page, text: cleaned });
      return;
    }
    let start = 0;
    while (start < cleaned.length) {
      const end = Math.min(cleaned.length, start + CHUNK_SIZE);
      out.push({ page, text: cleaned.slice(start, end).trim() });
      if (end >= cleaned.length) {
        break;
      }
      start = Math.max(end - OVERLAP, start + 1);
    }
  });
  return out.filter((row) => row.text.length > 0);
}

export function titleFromPath(relPath: string): string {
  const base = relPath.split(/[\\/]/).pop() ?? relPath;
  return base.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || relPath;
}
