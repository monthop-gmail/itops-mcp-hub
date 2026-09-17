export type HostBackend = "fixture" | "files";

export interface HostMount {
  alias: string;
  root: string;
}

export interface HostLimits {
  maxReadBytes: number;
  maxList: number;
  maxSearch: number;
  maxDepth: number;
  maxReadLines: number;
}

export interface HostStatus {
  ok: true;
  product: "host";
  backend: HostBackend;
  sample: boolean;
  read_only: true;
  write: false;
  shell: false;
  mounts: Array<{ alias: string; path: string }>;
  max_read_bytes: number;
  max_list: number;
  max_search: number;
  note: string;
}

export interface HostListEntry {
  path: string;
  type: "file" | "dir" | "symlink" | "other";
  bytes?: number;
  depth: number;
}

export interface HostStat {
  ok: true;
  path: string;
  type: "file" | "dir" | "symlink" | "other";
  bytes?: number;
  mtime?: string;
  mode?: string;
  binary?: boolean;
}

export interface HostRead {
  ok: true;
  path: string;
  binary: boolean;
  bytes: number;
  truncated: boolean;
  offset_line: number;
  text?: string;
  note?: string;
}

export interface HostSearchHit {
  path: string;
  kind: "name" | "content";
  line?: number;
  excerpt?: string;
}

export class HostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostError";
  }
}
