/** Thai combining marks that pdftotext often detaches from the base consonant. */
const THAI_COMBINING = "\u0E31\u0E34-\u0E3A\u0E47-\u0E4E";
const THAI_BASE = "\u0E01-\u0E2E";
const ZW = "\u200B-\u200D\uFEFF";

const COMBINING_RE = new RegExp(`[${THAI_COMBINING}]`, "gu");
const MARK_SPACE_MARK = new RegExp(`([${THAI_BASE}${THAI_COMBINING}])[ \\t\\u00A0]+([${THAI_COMBINING}])`, "gu");
const MARK_SPACE_BASE = new RegExp(`([${THAI_COMBINING}])[ \\t\\u00A0]+([${THAI_BASE}])`, "gu");
const BASE_SPACE_MARK = new RegExp(`([${THAI_BASE}])[ \\t\\u00A0]+([${THAI_COMBINING}])`, "gu");

export function foldThai(text: string): string {
  return text
    .normalize("NFC")
    .replace(new RegExp(`[${ZW}]`, "gu"), "")
    .replace(COMBINING_RE, "")
    .replace(/\s+/gu, "");
}

/**
 * Repair pdftotext layout artifacts: NFC, drop zero-width, glue floating Thai
 * vowels/tones back onto neighboring letters. Does not invent missing glyphs.
 */
export function normalizeThaiPdf(text: string): string {
  let out = text.normalize("NFC").replace(new RegExp(`[${ZW}]`, "gu"), "");
  for (let i = 0; i < 8; i += 1) {
    const next = out.replace(MARK_SPACE_MARK, "$1$2").replace(BASE_SPACE_MARK, "$1$2").replace(MARK_SPACE_BASE, "$1$2");
    if (next === out) {
      break;
    }
    out = next;
  }
  return out;
}

/** Higher = more likely the extractor split สระบน/ล่าง away from the consonant. */
export function thaiExtractionPenalty(text: string): number {
  const broken = text.match(BASE_SPACE_MARK)?.length ?? 0;
  const dangling = text.match(new RegExp(`\\s[${THAI_COMBINING}]`, "gu"))?.length ?? 0;
  return broken * 8 + dangling * 8;
}

export function pickBetterThaiExtract(layout: string, raw: string): { text: string; source: "layout" | "raw" } {
  const layoutTrim = layout.trim();
  const rawTrim = raw.trim();
  if (!layoutTrim && rawTrim) {
    return { text: normalizeThaiPdf(raw), source: "raw" };
  }
  if (!rawTrim && layoutTrim) {
    return { text: normalizeThaiPdf(layout), source: "layout" };
  }
  const left = normalizeThaiPdf(layout);
  const right = normalizeThaiPdf(raw);
  if (thaiExtractionPenalty(raw) < thaiExtractionPenalty(layout)) {
    return { text: right, source: "raw" };
  }
  return { text: left, source: "layout" };
}

/** FTS5 trigram index text: keep readable form plus a combining-mark-stripped fold. */
export function ftsIndexText(text: string): string {
  const norm = normalizeThaiPdf(text);
  const folded = foldThai(norm);
  const compact = norm.replace(/\s+/gu, "");
  if (folded.length >= 3 && folded !== compact) {
    return `${norm}\n${folded}`;
  }
  return norm;
}
