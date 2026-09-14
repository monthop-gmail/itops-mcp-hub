function sameText(a: string, b: string): boolean {
  const strip = (value: string) =>
    value
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
  return strip(a) === strip(b);
}

/**
 * Compare what was written against what Odoo stored.
 * Odoo discards writes to readonly fields without erroring.
 */
export function fieldsNotApplied(
  requested: Record<string, unknown>,
  stored: Record<string, unknown>,
): string[] {
  const dropped: string[] = [];

  for (const [field, want] of Object.entries(requested)) {
    if (!(field in stored)) {
      continue;
    }
    if (want !== null && typeof want === "object") {
      continue;
    }

    let got = stored[field];
    if (Array.isArray(got) && got.length === 2 && typeof got[0] === "number") {
      got = got[0];
    }
    if (want === "" && got === false) {
      continue;
    }
    if (got === want) {
      continue;
    }
    if (typeof want === "string" && typeof got === "string" && sameText(got, want)) {
      continue;
    }

    dropped.push(field);
  }

  return dropped;
}
