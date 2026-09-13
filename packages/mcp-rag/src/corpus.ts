import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chunkText, titleFromPath } from "./chunk.js";
import { extractFile, supportedExt } from "./extract.js";
import { excerptAround, indexTokens, queryTokens } from "./ngram.js";
import type { RagBackendKind, RagChunk, RagHit, RagSource, RagStatus } from "./types.js";
import { walkFiles } from "./walk.js";

export class RagCorpus {
  private db: DatabaseSync | null = null;
  private indexing = false;
  private lastError = "";
  private skipped = 0;

  constructor(
    private readonly backend: RagBackendKind,
    private readonly dataDir: string,
    private readonly indexPath: string,
    private readonly sample: boolean,
    private readonly note: string,
  ) {}

  open(): void {
    mkdirSync(dirname(this.indexPath), { recursive: true });
    this.db = new DatabaseSync(this.indexPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL,
        title TEXT NOT NULL,
        page INTEGER,
        text TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ngrams (
        gram TEXT NOT NULL,
        chunk_id INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ngrams_gram ON ngrams(gram);
      CREATE INDEX IF NOT EXISTS chunks_path ON chunks(path);
    `);
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
      this.db!.exec("DELETE FROM ngrams; DELETE FROM chunks;");
      const files = walkFiles(this.dataDir);
      const insertChunk = this.db!.prepare(
        "INSERT INTO chunks(path, title, page, text) VALUES (?, ?, ?, ?)",
      );
      const insertGram = this.db!.prepare("INSERT INTO ngrams(gram, chunk_id) VALUES (?, ?)");
      this.db!.exec("BEGIN");
      for (const file of files) {
        if (supportedExt(file.absPath) === "skip") {
          this.skipped += 1;
          continue;
        }
        const extracted = extractFile(file.absPath);
        if (!extracted.ok) {
          this.skipped += 1;
          continue;
        }
        const title = titleFromPath(file.relPath);
        for (const piece of chunkText(extracted.text)) {
          const result = insertChunk.run(file.relPath, title, piece.page, piece.text);
          const chunkId = Number(result.lastInsertRowid);
          for (const gram of indexTokens(piece.text)) {
            insertGram.run(gram, chunkId);
          }
        }
      }
      this.db!.exec("COMMIT");
      this.db!.prepare("INSERT OR REPLACE INTO meta(k, v) VALUES ('indexed_at', ?)").run(
        new Date().toISOString(),
      );
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
    const tokens = queryTokens(query);
    if (tokens.length === 0) {
      return [];
    }
    const prefix = (pathPrefix ?? "").replaceAll("\\", "/");
    const placeholders = tokens.map(() => "?").join(",");
    const sql = `
      SELECT c.id, c.path, c.title, c.page, c.text, COUNT(*) AS hits
      FROM ngrams n
      JOIN chunks c ON c.id = n.chunk_id
      WHERE n.gram IN (${placeholders})
        AND (? = '' OR c.path LIKE ?)
      GROUP BY c.id
      ORDER BY hits DESC, c.path ASC
      LIMIT ?
    `;
    const rows = this.db!.prepare(sql).all(...tokens, prefix, prefix ? `${prefix}%` : "", limit) as Array<{
      id: number;
      path: string;
      title: string;
      page: number | null;
      text: string;
      hits: number;
    }>;
    return rows.map((row) => ({
      chunk_id: Number(row.id),
      path: row.path,
      title: row.title,
      page: row.page,
      score: Number(row.hits) / tokens.length,
      excerpt: excerptAround(row.text, query),
    }));
  }

  getChunk(id: number): RagChunk | null {
    this.requireReady();
    const row = this.db!.prepare("SELECT id, path, title, page, text FROM chunks WHERE id = ?").get(
      id,
    ) as RagChunk | undefined;
    return row ?? null;
  }

  private requireReady(): void {
    if (!this.db) {
      throw new Error("RAG index is not open");
    }
    if (this.indexing) {
      throw new Error("RAG is still indexing — เรียก rag_get_status แล้วลองใหม่");
    }
  }
}

function extOf(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx >= 0 ? path.slice(idx).toLowerCase() : "";
}
