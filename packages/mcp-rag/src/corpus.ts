import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";
import { log } from "@itops/mcp-common";
import { chunkPageText, chunkText, titleFromPath } from "./chunk.js";
import { extractFile, extractPdfPages, pageNeedsOcr, renderPdfPageJpeg, supportedExt } from "./extract.js";
import { prepareSearch } from "./fts-query.js";
import { excerptAround } from "./ngram.js";
import {
  isOcrStatus,
  nowIso,
  ocrExcerpt,
  readSidecar,
  resolveUnderRoot,
  sidecarRelPath,
  SYNTHETIC_OCR_PDF,
  writeSidecar,
  type OcrCounts,
  type OcrJob,
  type OcrJobStatus,
} from "./ocr.js";
import type { RagBackendKind, RagChunk, RagHit, RagOcrPage, RagSource, RagStatus } from "./types.js";
import { walkFiles } from "./walk.js";

const SCHEMA = "2";
const FTS_DDL = `
  CREATE VIRTUAL TABLE chunks_fts USING fts5(
    path,
    title,
    text,
    content='chunks',
    content_rowid='id',
    tokenize='trigram'
  )
`;
const OCR_DDL = `
  CREATE TABLE IF NOT EXISTS ocr_jobs (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL,
    page INTEGER NOT NULL,
    status TEXT NOT NULL,
    char_count INTEGER NOT NULL DEFAULT 0,
    excerpt TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    sidecar TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    UNIQUE(path, page)
  );
  CREATE INDEX IF NOT EXISTS ocr_jobs_status ON ocr_jobs(status);
`;

export interface RagCorpusOptions {
  includeImage?: boolean;
  minChars?: number;
  ocrDir?: string;
}

export class RagCorpus {
  private db: SqliteDatabase | null = null;
  private indexing = false;
  private lastError = "";
  private skipped = 0;
  private readonly ocrDir: string;
  private readonly includeImage: boolean;
  private readonly minChars: number;

  constructor(
    private readonly backend: RagBackendKind,
    private readonly dataDir: string,
    private readonly indexPath: string,
    private readonly sample: boolean,
    private readonly note: string,
    options: RagCorpusOptions = {},
  ) {
    this.ocrDir = options.ocrDir ?? `${dirname(indexPath)}/ocr`;
    this.includeImage = options.includeImage ?? process.env.RAG_OCR_INCLUDE_IMAGE === "true";
    const parsed = Number(options.minChars ?? process.env.RAG_OCR_MIN_CHARS ?? 40);
    this.minChars = Number.isFinite(parsed) && parsed >= 0 ? parsed : 40;
  }

  open(): void {
    mkdirSync(dirname(this.indexPath), { recursive: true });
    mkdirSync(this.ocrDir, { recursive: true });
    this.db = new Database(this.indexPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    assertFts5(this.db);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL,
        title TEXT NOT NULL,
        page INTEGER,
        text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS chunks_path ON chunks(path);
      ${OCR_DDL}
    `);
    const schema = this.db.prepare("SELECT v FROM meta WHERE k = 'schema'").get() as { v: string } | undefined;
    if (schema?.v !== SCHEMA) {
      this.db.exec("DROP TABLE IF EXISTS ngrams; DROP TABLE IF EXISTS chunks_fts;");
      this.db.exec(FTS_DDL);
      this.db.prepare("INSERT OR REPLACE INTO meta(k, v) VALUES ('schema', ?)").run(SCHEMA);
    } else {
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        path, title, text, content='chunks', content_rowid='id', tokenize='trigram'
      )`);
    }
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  status(): RagStatus {
    const counts = this.db
      ? (this.db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number })
      : { n: 0 };
    const files = this.db
      ? (this.db.prepare("SELECT COUNT(DISTINCT path) AS n FROM chunks").get() as { n: number })
      : { n: 0 };
    const ready = Boolean(this.db) && !this.indexing && counts.n > 0;
    return {
      ok: !this.lastError,
      backend: this.backend,
      sample: this.sample,
      ready,
      indexing: this.indexing,
      data_dir: this.dataDir,
      file_count: files.n,
      chunk_count: counts.n,
      skipped_count: this.skipped,
      index_engine: "better-sqlite3 fts5 trigram",
      ocr: this.ocrSummary(),
      note: this.lastError || this.note,
    };
  }

  async reindex(): Promise<RagStatus> {
    if (!this.db) {
      this.open();
    }
    this.indexing = true;
    this.lastError = "";
    this.skipped = 0;
    try {
      this.db!.exec("DELETE FROM chunks;");
      this.db!.exec("DROP TABLE IF EXISTS chunks_fts;");
      this.db!.exec(FTS_DDL);
      const files = walkFiles(this.dataDir).filter((file) => !this.isIndexArtifact(file.absPath));
      log("info", "RAG indexing start", {
        backend: this.backend,
        files: files.length,
        dataDir: this.dataDir,
        engine: "fts5-trigram",
      });
      this.db!.exec("BEGIN");
      let fileIndex = 0;
      let chunkWrites = 0;
      for (const file of files) {
        fileIndex += 1;
        const kind = supportedExt(file.absPath);
        if (kind === "skip") {
          this.skipped += 1;
          continue;
        }
        const title = titleFromPath(file.relPath);
        if (kind === "pdf") {
          chunkWrites += await this.indexPdfFile(file.relPath, file.absPath, title, chunkWrites);
        } else {
          const extracted = await extractFile(file.absPath);
          if (!extracted.ok) {
            this.skipped += 1;
            continue;
          }
          chunkWrites += this.insertTextChunks(file.relPath, title, extracted.text, null);
        }
        log("info", "RAG indexed file", {
          path: file.relPath,
          fileIndex,
          total: files.length,
        });
        await yieldEventLoop();
      }
      this.indexRemainingSidecars();
      if (this.sample) {
        this.seedFixtureOcrJobs();
      }
      this.db!.exec("COMMIT");
      this.db!.prepare("INSERT OR REPLACE INTO meta(k, v) VALUES ('indexed_at', ?)").run(
        new Date().toISOString(),
      );
      this.db!.prepare("INSERT OR REPLACE INTO meta(k, v) VALUES ('schema', ?)").run(SCHEMA);
    } catch (error) {
      try {
        this.db?.exec("ROLLBACK");
      } catch {
        // ignore
      }
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.indexing = false;
    }
    return this.status();
  }

  listSources(limit = 80, pathPrefix?: string): RagSource[] {
    this.requireReady();
    const prefix = (pathPrefix ?? "").replaceAll("\\", "/");
    const rows = this.db!.prepare(
      `SELECT path, title, COUNT(*) AS chunk_count, SUM(LENGTH(text)) AS bytes
       FROM chunks
       WHERE (? = '' OR path LIKE ?)
       GROUP BY path, title
       ORDER BY path
       LIMIT ?`,
    ).all(prefix, prefix ? `${prefix}%` : "", limit) as Array<{
      path: string;
      title: string;
      chunk_count: number;
      bytes: number;
    }>;
    return rows.map((row) => ({
      path: row.path,
      title: row.title,
      ext: extOf(row.path),
      bytes: Number(row.bytes) || 0,
      chunk_count: Number(row.chunk_count) || 0,
    }));
  }

  search(query: string, limit = 8, pathPrefix?: string): RagHit[] {
    this.requireReady();
    const prepared = prepareSearch(query);
    if (!prepared.match && prepared.likes.length === 0) {
      return [];
    }
    const prefix = (pathPrefix ?? "").replaceAll("\\", "/");
    try {
      return this.searchFts(query, prepared, prefix, limit);
    } catch (error) {
      log("warn", "FTS5 MATCH failed; falling back to LIKE", {
        err: error instanceof Error ? error.message : String(error),
      });
      return this.searchLike(query, prepared.likes.length > 0 ? prepared.likes : [`%${query}%`], prefix, limit);
    }
  }

  getChunk(id: number): RagChunk | null {
    this.requireReady();
    const row = this.db!.prepare("SELECT id, path, title, page, text FROM chunks WHERE id = ?").get(
      id,
    ) as RagChunk | undefined;
    return row ?? null;
  }

  listOcrQueue(status: OcrJobStatus | "all" = "pending", pathPrefix?: string, limit = 40): OcrJob[] {
    this.requireDb();
    const prefix = (pathPrefix ?? "").replaceAll("\\", "/");
    const statusFilter = status === "all" ? "" : "AND status = ?";
    const params: unknown[] = status === "all" ? [] : [status];
    const rows = this.db!.prepare(
      `SELECT id, path, page, status, char_count, excerpt, note, sidecar, updated_at
       FROM ocr_jobs
       WHERE (? = '' OR path LIKE ?)
         ${statusFilter}
       ORDER BY status ASC, path ASC, page ASC
       LIMIT ?`,
    ).all(prefix, prefix ? `${prefix}%` : "", ...params, limit) as OcrJob[];
    return rows;
  }

  reviewOcrJob(jobId: number, action: "approve" | "reject", note?: string): OcrJob {
    this.requireDb();
    const job = this.getOcrJob(jobId);
    if (!job) {
      throw new Error(`ไม่พบ ocr job_id ${jobId}`);
    }
    if (job.status === "done") {
      throw new Error(`job_id ${jobId} บันทึก sidecar แล้ว — แก้ข้อความด้วย rag_submit_ocr ไม่ได้หลัง done`);
    }
    const next: OcrJobStatus = action === "approve" ? "approved" : "rejected";
    this.db!.prepare(
      "UPDATE ocr_jobs SET status = ?, note = ?, updated_at = ? WHERE id = ?",
    ).run(next, note?.trim() ?? job.note, nowIso(), jobId);
    const updated = this.getOcrJob(jobId);
    if (!updated) {
      throw new Error(`ไม่พบ ocr job_id ${jobId} หลังอัปเดต`);
    }
    return updated;
  }

  async getOcrPage(jobId: number): Promise<RagOcrPage> {
    this.requireDb();
    const job = this.getOcrJob(jobId);
    if (!job) {
      throw new Error(`ไม่พบ ocr job_id ${jobId}`);
    }
    const payload: RagOcrPage = {
      ok: true,
      job,
      include_image: this.includeImage,
      image_included: false,
    };
    if (!this.includeImage) {
      payload.image_omitted_reason =
        "RAG_OCR_INCLUDE_IMAGE=false — คลาวด์ดึงไฟล์ใน LAN ไม่ได้ และค่าเริ่มไม่ส่งภาพออกจากไซต์";
      return payload;
    }
    if (job.status !== "approved") {
      payload.image_omitted_reason = "ส่งภาพได้เฉพาะงานที่ approve แล้ว";
      return payload;
    }
    let abs: string;
    try {
      abs = resolveUnderRoot(this.dataDir, job.path);
    } catch (error) {
      payload.image_omitted_reason = error instanceof Error ? error.message : String(error);
      return payload;
    }
    if (!existsSync(abs)) {
      payload.image_omitted_reason = "ไม่มีไฟล์ PDF ต้นทาง (คิว fixture หรือ path หาย)";
      return payload;
    }
    const rendered = await renderPdfPageJpeg(abs, job.page);
    if (!rendered.ok) {
      payload.image_omitted_reason = rendered.reason;
      return payload;
    }
    payload.image_included = true;
    payload.image = { mimeType: rendered.mimeType, data: rendered.data };
    return payload;
  }

  submitOcr(jobId: number, text: string): { job: OcrJob; chunk_count: number } {
    this.requireReady();
    const job = this.getOcrJob(jobId);
    if (!job) {
      throw new Error(`ไม่พบ ocr job_id ${jobId}`);
    }
    if (job.status !== "approved") {
      throw new Error(`job_id ${jobId} สถานะ ${job.status} — ต้อง approve ก่อน rag_submit_ocr`);
    }
    const cleaned = text.replace(/\u0000/g, "").trim();
    if (!cleaned) {
      throw new Error("ข้อความ OCR ว่าง");
    }
    if (cleaned.length > 200_000) {
      throw new Error("ข้อความ OCR ยาวเกิน 200000 ตัวอักษร");
    }
    const sidecar = writeSidecar(this.ocrDir, job.path, job.page, cleaned);
    const title = titleFromPath(job.path);
    let chunkCount = 0;
    this.db!.exec("BEGIN");
    try {
      this.deleteChunksForPage(job.path, job.page);
      chunkCount = this.insertPageChunks(job.path, title, job.page, cleaned);
      this.db!.prepare(
        `UPDATE ocr_jobs
         SET status = 'done', char_count = ?, excerpt = ?, sidecar = ?, updated_at = ?
         WHERE id = ?`,
      ).run(cleaned.replace(/\s+/gu, "").length, ocrExcerpt(cleaned), sidecar, nowIso(), jobId);
      this.db!.exec("COMMIT");
    } catch (error) {
      try {
        this.db!.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw error;
    }
    const updated = this.getOcrJob(jobId);
    if (!updated) {
      throw new Error(`ไม่พบ ocr job_id ${jobId} หลังบันทึก`);
    }
    return { job: updated, chunk_count: chunkCount };
  }

  private async indexPdfFile(
    relPath: string,
    absPath: string,
    title: string,
    chunkWrites: number,
  ): Promise<number> {
    const extracted = await extractPdfPages(absPath);
    if (!extracted.ok) {
      this.skipped += 1;
      return 0;
    }
    let wrote = 0;
    let ticks = chunkWrites;
    for (let i = 0; i < extracted.pages.length; i += 1) {
      const page = i + 1;
      const pageText = extracted.pages[i] ?? "";
      const sidecar = readSidecar(this.ocrDir, relPath, page);
      let n = 0;
      if (sidecar) {
        n = this.insertPageChunks(relPath, title, page, sidecar);
        this.upsertOcrJob(relPath, page, "done", sidecar, sidecarRelPath(relPath, page));
      } else if (pageNeedsOcr(pageText, this.minChars)) {
        this.upsertOcrJobKeepStatus(relPath, page, pageText, sidecarRelPath(relPath, page));
      } else {
        n = this.insertPageChunks(relPath, title, page, pageText);
        this.db!.prepare(
          "DELETE FROM ocr_jobs WHERE path = ? AND page = ? AND status = 'pending'",
        ).run(relPath, page);
      }
      wrote += n;
      ticks += n;
      if (ticks % 80 === 0) {
        await yieldEventLoop();
      }
    }
    return wrote;
  }

  private insertTextChunks(relPath: string, title: string, text: string, page: number | null): number {
    const pieces = page != null ? chunkPageText(text, page) : chunkText(text);
    return this.insertPieces(relPath, title, pieces);
  }

  private insertPageChunks(relPath: string, title: string, page: number, text: string): number {
    return this.insertPieces(relPath, title, chunkPageText(text, page));
  }

  private insertPieces(
    relPath: string,
    title: string,
    pieces: Array<{ page: number | null; text: string }>,
  ): number {
    const insertChunk = this.db!.prepare(
      "INSERT INTO chunks(path, title, page, text) VALUES (?, ?, ?, ?)",
    );
    const insertFts = this.db!.prepare(
      "INSERT INTO chunks_fts(rowid, path, title, text) VALUES (?, ?, ?, ?)",
    );
    let n = 0;
    for (const piece of pieces) {
      const result = insertChunk.run(relPath, title, piece.page, piece.text);
      insertFts.run(Number(result.lastInsertRowid), relPath, title, piece.text);
      n += 1;
    }
    return n;
  }

  private deleteChunksForPage(relPath: string, page: number): void {
    const rows = this.db!.prepare("SELECT id FROM chunks WHERE path = ? AND page = ?").all(
      relPath,
      page,
    ) as Array<{ id: number }>;
    const delFts = this.db!.prepare("INSERT INTO chunks_fts(chunks_fts, rowid) VALUES('delete', ?)");
    const del = this.db!.prepare("DELETE FROM chunks WHERE id = ?");
    for (const row of rows) {
      delFts.run(row.id);
      del.run(row.id);
    }
  }

  private indexRemainingSidecars(): void {
    const jobs = this.db!.prepare("SELECT path, page FROM ocr_jobs").all() as Array<{
      path: string;
      page: number;
    }>;
    for (const job of jobs) {
      const sidecar = readSidecar(this.ocrDir, job.path, job.page);
      if (!sidecar) {
        continue;
      }
      const existing = this.db!.prepare(
        "SELECT COUNT(*) AS n FROM chunks WHERE path = ? AND page = ?",
      ).get(job.path, job.page) as { n: number };
      if (existing.n > 0) {
        continue;
      }
      this.insertPageChunks(job.path, titleFromPath(job.path), job.page, sidecar);
      this.upsertOcrJob(job.path, job.page, "done", sidecar, sidecarRelPath(job.path, job.page));
    }
  }

  private upsertOcrJob(
    relPath: string,
    page: number,
    status: OcrJobStatus,
    text: string,
    sidecar: string,
  ): void {
    const chars = text.replace(/\s+/gu, "").length;
    this.db!.prepare(
      `INSERT INTO ocr_jobs (path, page, status, char_count, excerpt, note, sidecar, updated_at)
       VALUES (?, ?, ?, ?, ?, '', ?, ?)
       ON CONFLICT(path, page) DO UPDATE SET
         status = excluded.status,
         char_count = excluded.char_count,
         excerpt = excluded.excerpt,
         sidecar = excluded.sidecar,
         updated_at = excluded.updated_at`,
    ).run(relPath, page, status, chars, ocrExcerpt(text) || "หน้าสแกนว่าง", sidecar, nowIso());
  }

  private upsertOcrJobKeepStatus(relPath: string, page: number, text: string, sidecar: string): void {
    const chars = text.replace(/\s+/gu, "").length;
    this.db!.prepare(
      `INSERT INTO ocr_jobs (path, page, status, char_count, excerpt, note, sidecar, updated_at)
       VALUES (?, ?, 'pending', ?, ?, '', ?, ?)
       ON CONFLICT(path, page) DO UPDATE SET
         char_count = excluded.char_count,
         excerpt = excluded.excerpt,
         sidecar = excluded.sidecar,
         updated_at = excluded.updated_at`,
    ).run(relPath, page, chars, ocrExcerpt(text) || "หน้าสแกนว่าง — รอ OCR", sidecar, nowIso());
  }

  private seedFixtureOcrJobs(): void {
    const excerpt = "สแกนว่าง (คิวทดสอบ fixture) — ยังไม่มีข้อความจาก pdftotext";
    for (const page of [1, 2]) {
      this.db!.prepare(
        `INSERT OR IGNORE INTO ocr_jobs (path, page, status, char_count, excerpt, note, sidecar, updated_at)
         VALUES (?, ?, 'pending', 0, ?, 'fixture', ?, ?)`,
      ).run(SYNTHETIC_OCR_PDF, page, excerpt, sidecarRelPath(SYNTHETIC_OCR_PDF, page), nowIso());
    }
  }

  private getOcrJob(id: number): OcrJob | null {
    const row = this.db!.prepare(
      `SELECT id, path, page, status, char_count, excerpt, note, sidecar, updated_at
       FROM ocr_jobs WHERE id = ?`,
    ).get(id) as OcrJob | undefined;
    return row ?? null;
  }

  private ocrSummary(): RagStatus["ocr"] {
    const counts: OcrCounts = { pending: 0, approved: 0, rejected: 0, done: 0 };
    if (this.db) {
      const rows = this.db
        .prepare("SELECT status, COUNT(*) AS n FROM ocr_jobs GROUP BY status")
        .all() as Array<{ status: string; n: number }>;
      for (const row of rows) {
        if (isOcrStatus(row.status)) {
          counts[row.status] = Number(row.n) || 0;
        }
      }
    }
    return {
      ...counts,
      include_image: this.includeImage,
      min_chars: this.minChars,
    };
  }

  private searchFts(
    query: string,
    prepared: ReturnType<typeof prepareSearch>,
    prefix: string,
    limit: number,
  ): RagHit[] {
    if (!prepared.match) {
      return this.searchLike(query, prepared.likes, prefix, limit);
    }
    const likeSql = prepared.likes.map(() => "AND c.text LIKE ? ESCAPE '\\'").join(" ");
    const sql = `
      SELECT c.id, c.path, c.title, c.page, c.text, bm25(chunks_fts) AS rank
      FROM chunks_fts
      JOIN chunks c ON c.id = chunks_fts.rowid
      WHERE chunks_fts MATCH ?
        AND (? = '' OR c.path LIKE ?)
        ${likeSql}
      ORDER BY rank ASC, c.path ASC
      LIMIT ?
    `;
    const rows = this.db!.prepare(sql).all(
      prepared.match,
      prefix,
      prefix ? `${prefix}%` : "",
      ...prepared.likes,
      limit,
    ) as Array<{
      id: number;
      path: string;
      title: string;
      page: number | null;
      text: string;
      rank: number;
    }>;
    return rows.map((row) => toHit(row, query));
  }

  private searchLike(query: string, likes: string[], prefix: string, limit: number): RagHit[] {
    if (likes.length === 0) {
      return [];
    }
    const likeSql = likes.map(() => "text LIKE ? ESCAPE '\\'").join(" AND ");
    const sql = `
      SELECT id, path, title, page, text, 0 AS rank
      FROM chunks
      WHERE ${likeSql}
        AND (? = '' OR path LIKE ?)
      ORDER BY path ASC
      LIMIT ?
    `;
    const rows = this.db!.prepare(sql).all(...likes, prefix, prefix ? `${prefix}%` : "", limit) as Array<{
      id: number;
      path: string;
      title: string;
      page: number | null;
      text: string;
      rank: number;
    }>;
    return rows.map((row) => toHit(row, query));
  }

  private isIndexArtifact(absPath: string): boolean {
    const abs = resolve(absPath);
    const ocrRoot = resolve(this.ocrDir);
    if (abs === ocrRoot || abs.startsWith(`${ocrRoot}/`)) {
      return true;
    }
    const indexAbs = resolve(this.indexPath);
    if (abs === indexAbs || abs.startsWith(`${indexAbs}-`)) {
      return true;
    }
    return abs.endsWith(".ocr.md");
  }

  private requireDb(): void {
    if (!this.db) {
      throw new Error("RAG index is not open");
    }
  }

  private requireReady(): void {
    this.requireDb();
    if (this.indexing) {
      throw new Error("RAG is still indexing — เรียก rag_get_status แล้วลองใหม่");
    }
  }
}

function toHit(
  row: { id: number; path: string; title: string; page: number | null; text: string; rank: number },
  query: string,
): RagHit {
  const rank = Number(row.rank);
  return {
    chunk_id: Number(row.id),
    path: row.path,
    title: row.title,
    page: row.page,
    score: Number.isFinite(rank) ? -rank : 0,
    excerpt: excerptAround(row.text, query),
  };
}

function assertFts5(db: SqliteDatabase): void {
  const rows = db.prepare("PRAGMA compile_options").all() as Array<{ compile_options: string }>;
  const enabled = rows.some((row) => row.compile_options.includes("ENABLE_FTS5"));
  if (!enabled) {
    throw new Error(
      "SQLite build has no FTS5. Stock better-sqlite3 already sets SQLITE_ENABLE_FTS5 — do not swap in a custom amalgamation without that flag.",
    );
  }
}

function extOf(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx >= 0 ? path.slice(idx).toLowerCase() : "";
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
