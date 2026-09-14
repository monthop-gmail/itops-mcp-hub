import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const OCR_STATUSES = ["pending", "approved", "rejected", "done"] as const;
export type OcrJobStatus = (typeof OCR_STATUSES)[number];

export const SYNTHETIC_OCR_PDF = "งบประมาณ-2570/สำนักงบประมาณ/แบบสแกน-ปก.pdf";

export interface OcrJob {
  id: number;
  path: string;
  page: number;
  status: OcrJobStatus;
  char_count: number;
  excerpt: string;
  note: string;
  sidecar: string;
  updated_at: string;
}

export interface OcrCounts {
  pending: number;
  approved: number;
  rejected: number;
  done: number;
}

export function isOcrStatus(value: string): value is OcrJobStatus {
  return (OCR_STATUSES as readonly string[]).includes(value);
}

export function normalizeRelPath(relPath: string): string {
  return relPath.replaceAll("\\", "/").replace(/^\/+/, "");
}

export function sidecarRelPath(docRel: string, page: number): string {
  return `${normalizeRelPath(docRel)}.p${page}.ocr.md`;
}

export function sidecarAbsPath(ocrDir: string, docRel: string, page: number): string {
  const rel = sidecarRelPath(docRel, page);
  if (rel.includes("..")) {
    throw new Error("ocr sidecar path must not contain '..'");
  }
  const root = resolve(ocrDir);
  const abs = resolve(join(ocrDir, rel));
  if (abs !== root && !abs.startsWith(`${root}/`)) {
    throw new Error("ocr sidecar escaped the index OCR directory");
  }
  return abs;
}

export function resolveUnderRoot(rootDir: string, relPath: string): string {
  const rel = normalizeRelPath(relPath);
  if (rel.includes("..")) {
    throw new Error("path must not contain '..'");
  }
  const root = resolve(rootDir);
  const abs = resolve(join(rootDir, rel));
  if (abs !== root && !abs.startsWith(`${root}/`)) {
    throw new Error("path escaped the data directory");
  }
  return abs;
}

export function readSidecar(ocrDir: string, docRel: string, page: number): string | null {
  try {
    const text = readFileSync(sidecarAbsPath(ocrDir, docRel, page), "utf8").trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export function writeSidecar(ocrDir: string, docRel: string, page: number, text: string): string {
  const abs = sidecarAbsPath(ocrDir, docRel, page);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text.replace(/\s+$/, "") + "\n", "utf8");
  return sidecarRelPath(docRel, page);
}

export function ocrExcerpt(text: string, max = 180): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) {
    return flat;
  }
  return `${flat.slice(0, max)}…`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
