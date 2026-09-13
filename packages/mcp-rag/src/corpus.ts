import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";
import { log } from "@itops/mcp-common";
import { chunkText, titleFromPath } from "./chunk.js";
import { extractFile, supportedExt } from "./extract.js";
import { prepareSearch } from "./fts-query.js";
import { excerptAround } from "./ngram.js";
import type { RagBackendKind, RagChunk, RagHit, RagSource, RagStatus } from "./types.js";
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

export class RagCorpus {
  private db: SqliteDatabase | null = null;
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
      const files = walkFiles(this.dataDir);
      log("info", "RAG indexing start", {
        backend: this.backend,
        files: files.length,
        dataDir: this.dataDir,
        engine: "fts5-trigram",
      });
      const insertChunk = this.db!.prepare(
        "INSERT INTO chunks(path, title, page, text) VALUES (?, ?, ?, ?)",
      );
      const insertFts = this.db!.prepare(
        "INSERT INTO chunks_fts(rowid, path, title, text) VALUES (?, ?, ?, ?)",
      );
      this.db!.exec("BEGIN");
      let fileIndex = 0;
      let chunkWrites = 0;
      for (const file of files) {
        fileIndex += 1;
        if (supportedExt(file.absPath) === "skip") {
          this.skipped += 1;
          continue;
        }
        const extracted = await extractFile(file.absPath);
        if (!extracted.ok) {
          this.skipped += 1;
          continue;
        }
        const title = titleFromPath(file.relPath);
        for (const piece of chunkText(extracted.text)) {
          const result = insertChunk.run(file.relPath, title, piece.page, piece.text);
          insertFts.run(Number(result.lastInsertRowid), file.relPath, title, piece.text);
          chunkWrites += 1;
          if (chunkWrites % 80 === 0) {
            await yieldEventLoop();
          }
        }
        log("info", "RAG indexed file", {
          path: file.relPath,
          fileIndex,
          total: files.length,
        });
        await yieldEventLoop();
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

  private requireReady(): void {
    if (!this.db) {
      throw new Error("RAG index is not open");
    }
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
