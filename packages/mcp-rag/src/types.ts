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
  index_engine?: string;
  ocr?: {
    pending: number;
    approved: number;
    rejected: number;
    done: number;
    include_image: boolean;
    min_chars: number;
    provider: string;
    providers: Array<{
      id: string;
      label: string;
      ready: boolean;
      model?: string;
      api_base?: string;
    }>;
  };
  note: string;
}

export interface RagOcrPage {
  ok: true;
  job: {
    id: number;
    path: string;
    page: number;
    status: string;
    char_count: number;
    excerpt: string;
    note: string;
    sidecar: string;
    updated_at: string;
  };
  include_image: boolean;
  image_included: boolean;
  image_omitted_reason?: string;
  image?: { mimeType: "image/jpeg"; data: string };
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
