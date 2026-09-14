import { foldThai, normalizeThaiPdf } from "./thai-normalize.js";

/** FTS5 trigram needs 3+ characters; shorter Thai terms fall back to LIKE. */

export interface PreparedSearch {
  match: string | null;
  likes: string[];
}

export function prepareSearch(query: string): PreparedSearch {
  const normalized = normalizeThaiPdf(query);
  const terms = normalized
    .trim()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  const matchParts: string[] = [];
  const likes: string[] = [];
  for (const term of terms) {
    const folded = foldThai(term);
    if ([...term].length >= 3) {
      const quoted = `"${term.replaceAll('"', '""')}"`;
      if (folded.length >= 3 && folded !== term.replace(/\s+/gu, "")) {
        matchParts.push(`(${quoted} OR "${folded.replaceAll('"', '""')}")`);
      } else {
        matchParts.push(quoted);
      }
    } else {
      likes.push(`%${escapeLike(term)}%`);
    }
  }
  return {
    match: matchParts.length > 0 ? matchParts.join(" AND ") : null,
    likes,
  };
}

export function escapeLike(term: string): string {
  return term.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
