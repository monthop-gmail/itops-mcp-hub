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
    const page = pages.length > 1 ? index + 1 : null;
    out.push(...splitChunks(pageText, page));
  });
  return out;
}

/** Chunk OCR/sidecar text as a single known PDF page (ignore extra form feeds). */
export function chunkPageText(raw: string, page: number): TextChunk[] {
  return splitChunks(raw.replace(/\f/g, "\n"), page);
}

function splitChunks(pageText: string, page: number | null): TextChunk[] {
  const cleaned = pageText.replace(/\u0000/g, "").trim();
  if (!cleaned) {
    return [];
  }
  if (cleaned.length <= CHUNK_SIZE) {
    return [{ page, text: cleaned }];
  }
  const out: TextChunk[] = [];
  let start = 0;
  while (start < cleaned.length) {
    const end = Math.min(cleaned.length, start + CHUNK_SIZE);
    const slice = cleaned.slice(start, end).trim();
    if (slice) {
      out.push({ page, text: slice });
    }
    if (end >= cleaned.length) {
      break;
    }
    start = Math.max(end - OVERLAP, start + 1);
  }
  return out;
}

export function titleFromPath(relPath: string): string {
  const base = relPath.split(/[\\/]/).pop() ?? relPath;
  return base.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || relPath;
}
