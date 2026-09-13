export type RagBackendKind = "fixture" | "files";

export interface RagStatus {
  ok: boolean;
  backend: RagBackendKind;
  sample: boolean;
  ready: boolean;
  indexing: boolean;
  data_dir: string;
  file_count: number;
  chunk_count: number;
  skipped_count: number;
  note: string;
}

export interface RagSource {
  path: string;
  title: string;
  ext: string;
  bytes: number;
  chunk_count: number;
}

export interface RagHit {
  chunk_id: number;
  path: string;
  title: string;
  page: number | null;
  score: number;
  excerpt: string;
}

export interface RagChunk {
  id: number;
  path: string;
  title: string;
  page: number | null;
  text: string;
}
