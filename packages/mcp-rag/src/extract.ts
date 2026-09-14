import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

const TEXT_EXTS = new Set([".txt", ".md", ".markdown", ".csv", ".tsv", ".log", ".html", ".htm", ".json", ".xml"]);
const PDF_EXTS = new Set([".pdf"]);

export type ExtractResult =
  | { ok: true; text: string; extractor: string }
  | { ok: false; reason: string };

export function supportedExt(path: string): "text" | "pdf" | "skip" {
  const ext = extname(path).toLowerCase();
  if (TEXT_EXTS.has(ext)) {
    return "text";
  }
  if (PDF_EXTS.has(ext)) {
    return "pdf";
  }
  return "skip";
}

export function visibleCharCount(text: string): number {
  return text.replace(/\s+/gu, "").length;
}

/** True when a PDF page has too little selectable text and should enter the OCR queue. */
export function pageNeedsOcr(text: string, minChars = 40): boolean {
  return visibleCharCount(text) < minChars;
}

export async function extractFile(path: string): Promise<ExtractResult> {
  const kind = supportedExt(path);
  if (kind === "skip") {
    return { ok: false, reason: `unsupported ${extname(path) || "extension"}` };
  }
  if (kind === "pdf") {
    const pages = await extractPdfPages(path);
    if (!pages.ok) {
      return pages;
    }
    return { ok: true, text: pages.pages.join("\f"), extractor: pages.extractor };
  }
  try {
    const raw = readFileSync(path);
    const text = decodeDocument(raw);
    return { ok: true, text: stripMarkup(path, text), extractor: "text" };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export type PdfPagesResult =
  | { ok: true; pages: string[]; extractor: string; page_count: number }
  | { ok: false; reason: string };

export async function extractPdfPages(path: string): Promise<PdfPagesResult> {
  const extracted = await runPdfToText(path);
  if (!extracted.ok) {
    return extracted;
  }
  const reported = await pdfPageCount(path);
  const pages = alignPdfPages(extracted.text, reported);
  return {
    ok: true,
    pages,
    extractor: extracted.extractor,
    page_count: pages.length,
  };
}

const MAX_JPEG_BYTES = 1_500_000;

export async function renderPdfPageJpeg(
  path: string,
  page: number,
  maxBytes = MAX_JPEG_BYTES,
): Promise<{ ok: true; mimeType: "image/jpeg"; data: string } | { ok: false; reason: string }> {
  if (!Number.isInteger(page) || page < 1) {
    return { ok: false, reason: "invalid page" };
  }
  const scales = [1400, 1100, 850, 640];
  let lastReason = "pdftoppm produced no jpeg";
  for (const scale of scales) {
    const rendered = await runPdfToPpm(path, page, scale);
    if (!rendered.ok) {
      lastReason = rendered.reason;
      continue;
    }
    if (rendered.bytes.length > maxBytes) {
      lastReason = `jpeg ${rendered.bytes.length} bytes exceeds ${maxBytes}`;
      continue;
    }
    return {
      ok: true,
      mimeType: "image/jpeg",
      data: rendered.bytes.toString("base64"),
    };
  }
  return { ok: false, reason: lastReason };
}

function alignPdfPages(raw: string, reportedPages: number | null): string[] {
  let parts = raw.split("\f");
  while (parts.length > 1 && parts[parts.length - 1].trim() === "") {
    parts = parts.slice(0, -1);
  }
  if (parts.length === 0) {
    parts = [""];
  }
  if (reportedPages != null && reportedPages > 0) {
    if (parts.length < reportedPages) {
      parts = parts.concat(Array.from({ length: reportedPages - parts.length }, () => ""));
    } else if (parts.length > reportedPages) {
      parts = parts.slice(0, reportedPages);
    }
  }
  return parts;
}

function runPdfToText(path: string): Promise<ExtractResult> {
  return spawnText("pdftotext", ["-layout", "-enc", "UTF-8", path, "-"], 180_000, "pdftotext");
}

function pdfPageCount(path: string): Promise<number | null> {
  return spawnText("pdfinfo", [path], 30_000, "pdfinfo").then((result) => {
    if (!result.ok) {
      return null;
    }
    const match = result.text.match(/^Pages:\s+(\d+)\s*$/m);
    if (!match) {
      return null;
    }
    const n = Number(match[1]);
    return Number.isInteger(n) && n > 0 ? n : null;
  });
}

function runPdfToPpm(
  path: string,
  page: number,
  scaleTo: number,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; reason: string }> {
  const dir = mkdtempSync(join(tmpdir(), "itops-ocr-"));
  const prefix = join(dir, "page");
  return new Promise((resolve) => {
    const child = spawn(
      "pdftoppm",
      ["-jpeg", "-jpegopt", "quality=72", "-f", String(page), "-l", String(page), "-scale-to", String(scaleTo), "-singlefile", path, prefix],
      { timeout: 60_000 },
    );
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.on("error", (error) => {
      rmSync(dir, { recursive: true, force: true });
      resolve({ ok: false, reason: `pdftoppm missing or failed: ${error.message}` });
    });
    child.on("close", (status) => {
      try {
        if (status !== 0) {
          const detail = Buffer.concat(stderr).toString("utf8").slice(0, 300);
          resolve({ ok: false, reason: detail || `pdftoppm exit ${status}` });
          return;
        }
        const bytes = readFileSync(`${prefix}.jpg`);
        resolve({ ok: true, bytes });
      } catch (error) {
        resolve({
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}

function spawnText(
  cmd: string,
  args: string[],
  timeout: number,
  extractor: string,
): Promise<ExtractResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { timeout });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const finish = (result: ExtractResult) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.on("error", (error) => {
      finish({ ok: false, reason: `${cmd} missing or failed: ${error.message}` });
    });
    child.on("close", (status) => {
      if (status !== 0) {
        const detail = Buffer.concat(stderr).toString("utf8").slice(0, 300);
        finish({ ok: false, reason: detail || `${cmd} exit ${status}` });
        return;
      }
      finish({
        ok: true,
        text: Buffer.concat(stdout).toString("utf8"),
        extractor,
      });
    });
  });
}

function decodeDocument(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.toString("utf16le");
  }
  return buf.toString("utf8");
}

function stripMarkup(path: string, text: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".html" || ext === ".htm") {
    return text
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }
  return text;
}
