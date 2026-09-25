import { createHash } from "node:crypto";
import type { LegalHit, LegalSource } from "./types.js";

// Deliberately fictional law. Never present fixture text as an actual statute.
const FIXTURE: Omit<LegalSource, "source_sha256">[] = [
  {
    id: "fixture-10-v1", law_id: "fixture-act", law_name: "กฎหมายตัวอย่างเพื่อทดสอบเท่านั้น",
    section: "10", text: "มาตรา 10 การขอสำเนาเอกสารตัวอย่างต้องระบุหมายเลขคำขอ",
    source_url: "https://example.invalid/legal-fixture/section-10", effective_from: "2020-01-01",
    effective_to: null, retrieved_at: "2026-09-25", version: "fixture-v1",
  },
  {
    id: "fixture-11-v1", law_id: "fixture-act", law_name: "กฎหมายตัวอย่างเพื่อทดสอบเท่านั้น",
    section: "11", text: "มาตรา 11 การตรวจสำเนาเอกสารตัวอย่างต้องบันทึกชื่อผู้ตรวจ",
    source_url: "https://example.invalid/legal-fixture/section-11", effective_from: "2020-01-01",
    effective_to: null, retrieved_at: "2026-09-25", version: "fixture-v1",
  },
  {
    id: "fixture-12-v1", law_id: "fixture-act", law_name: "กฎหมายตัวอย่างเพื่อทดสอบเท่านั้น",
    section: "12", text: "มาตรา 12 ข้อความตัวอย่างฉบับเก่าที่สิ้นผลแล้ว",
    source_url: "https://example.invalid/legal-fixture/section-12", effective_from: "2020-01-01",
    effective_to: "2022-12-31", retrieved_at: "2026-09-25", version: "fixture-v1",
  },
  {
    id: "fixture-13-v1", law_id: "fixture-act", law_name: "กฎหมายตัวอย่างเพื่อทดสอบเท่านั้น",
    section: "13", text: "มาตรา 13 ข้อความตัวอย่างที่ยังไม่ทราบวันมีผล",
    source_url: "https://example.invalid/legal-fixture/section-13", effective_from: null,
    effective_to: null, retrieved_at: "2026-09-25", version: "fixture-v1",
  },
];

export function sourceHash(source: Omit<LegalSource, "source_sha256">): string {
  return createHash("sha256").update(JSON.stringify(source)).digest("hex");
}

export const fixtureCorpus: readonly LegalSource[] = FIXTURE.map((row) => ({
  ...row, source_sha256: sourceHash(row),
}));

export function legalSearch(
  query: string,
  asOf: string,
  limit = 5,
  corpus: readonly LegalSource[] = fixtureCorpus,
): LegalHit[] {
  if (!validDate(asOf)) throw new Error("as_of must be a valid YYYY-MM-DD date");
  const section = /มาตรา\s*([0-9๐-๙]+)/u.exec(query)?.[1]?.replace(/[๐-๙]/gu, (digit) =>
    String("๐๑๒๓๔๕๖๗๘๙".indexOf(digit)),
  );
  const terms = query.replace(/มาตรา\s*[0-9๐-๙]+/gu, " ").trim().toLowerCase().split(/\s+/u).filter(Boolean);
  return corpus
    .filter((row) => !section || row.section === section)
    .map((row) => {
      const searchable = `${row.law_name} ${row.text}`.toLowerCase();
      const score = (section ? 100 : 0) + terms.filter((term) => searchable.includes(term)).length;
      const effective_status = !row.effective_from ? "unknown" as const
        : row.effective_from > asOf ? "future" as const
        : row.effective_to && asOf > row.effective_to ? "expired" as const
        : "current" as const;
      return { ...row, evidence_id: `${row.id}@${row.source_sha256}`, score, effective_status };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, Math.min(Math.max(limit, 1), 10));
}

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function isEffective(source: LegalSource, asOf: string): boolean {
  return Boolean(source.effective_from && source.effective_from <= asOf && (!source.effective_to || asOf <= source.effective_to));
}
