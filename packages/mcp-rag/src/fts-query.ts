/** FTS5 trigram needs 3+ characters; shorter Thai terms fall back to LIKE. */

export interface PreparedSearch {
  match: string | null;
  likes: string[];
}

export function prepareSearch(query: string): PreparedSearch {
  const terms = query
    .trim()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  const matchParts: string[] = [];
  const likes: string[] = [];
  for (const term of terms) {
    if ([...term].length >= 3) {
      matchParts.push(`"${term.replaceAll('"', '""')}"`);
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
