import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

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

export async function extractFile(path: string): Promise<ExtractResult> {
  const kind = supportedExt(path);
  if (kind === "skip") {
    return { ok: false, reason: `unsupported ${extname(path) || "extension"}` };
  }
  if (kind === "pdf") {
    return extractPdf(path);
  }
  try {
    const raw = readFileSync(path);
    const text = decodeDocument(raw);
    return { ok: true, text: stripMarkup(path, text), extractor: "text" };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function extractPdf(path: string): Promise<ExtractResult> {
  return new Promise((resolve) => {
    const child = spawn("pdftotext", ["-layout", "-enc", "UTF-8", path, "-"], {
      timeout: 180_000,
    });
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
      finish({ ok: false, reason: `pdftotext missing or failed: ${error.message}` });
    });
    child.on("close", (status) => {
      if (status !== 0) {
        const detail = Buffer.concat(stderr).toString("utf8").slice(0, 300);
        finish({ ok: false, reason: detail || `pdftotext exit ${status}` });
        return;
      }
      finish({
        ok: true,
        text: Buffer.concat(stdout).toString("utf8"),
        extractor: "pdftotext",
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
