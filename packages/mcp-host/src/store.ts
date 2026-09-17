import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { HostAudit } from "./audit.js";
import { isSensitiveRel, posixify, resolvePublicPath } from "./jail.js";
import type {
  HostBackend,
  HostLimits,
  HostListEntry,
  HostMount,
  HostRead,
  HostSearchHit,
  HostStat,
  HostStatus,
} from "./types.js";
import { HostError } from "./types.js";

const SKIP_DIRS = new Set([".git", "node_modules", "$recycle.bin", "system volume information"]);

function staysInside(root: string, abs: string): boolean {
  const rel = relative(root, abs);
  return rel === "" || (!rel.startsWith("..") && rel !== "..");
}

export class HostFs {
  constructor(
    readonly backend: HostBackend,
    readonly mounts: HostMount[],
    readonly limits: HostLimits,
    readonly sample: boolean,
    readonly note: string,
    private readonly audit: HostAudit,
  ) {}

  status(): HostStatus {
    return {
      ok: true,
      product: "host",
      backend: this.backend,
      sample: this.sample,
      read_only: true,
      write: false,
      shell: false,
      mounts: this.mounts.map((m) => ({ alias: m.alias, path: m.root })),
      max_read_bytes: this.limits.maxReadBytes,
      max_list: this.limits.maxList,
      max_search: this.limits.maxSearch,
      note: this.note,
    };
  }

  list(pathInput: string | undefined, depth = 2, limit?: number): HostListEntry[] {
    const cap = Math.min(limit ?? this.limits.maxList, this.limits.maxList);
    const maxDepth = Math.min(Math.max(depth, 0), this.limits.maxDepth);
    const out: HostListEntry[] = [];
    if (!pathInput?.trim() && this.mounts.length !== 1) {
      for (const mount of this.mounts) {
        out.push({ path: mount.alias, type: "dir", depth: 0 });
        if (out.length >= cap) {
          break;
        }
      }
      this.audit.record({ tool: "host_list", path: "(roots)", ok: true });
      return out;
    }
    const start = resolvePublicPath(this.mounts, pathInput?.trim() || this.mounts[0].alias);
    this.walkList(start.abs, start.mount, 0, maxDepth, cap, out);
    this.audit.record({ tool: "host_list", path: start.publicPath, ok: true });
    return out;
  }

  stat(pathInput: string): HostStat {
    const resolved = resolvePublicPath(this.mounts, pathInput);
    const st = lstatSync(resolved.abs);
    const type = st.isDirectory() ? "dir" : st.isFile() ? "file" : st.isSymbolicLink() ? "symlink" : "other";
    const result: HostStat = {
      ok: true,
      path: resolved.publicPath,
      type,
      bytes: st.isFile() ? st.size : undefined,
      mtime: st.mtime.toISOString(),
      mode: (st.mode & 0o777).toString(8),
      binary: st.isFile() ? isBinaryFile(resolved.abs, this.limits.maxReadBytes) : undefined,
    };
    this.audit.record({ tool: "host_stat", path: resolved.publicPath, ok: true });
    return result;
  }

  read(pathInput: string, offsetLine = 0, maxLines?: number): HostRead {
    const resolved = resolvePublicPath(this.mounts, pathInput);
    const st = statSync(resolved.abs);
    if (!st.isFile()) {
      throw new HostError("Not a file");
    }
    if (st.size > this.limits.maxReadBytes) {
      this.audit.record({ tool: "host_read", path: resolved.publicPath, ok: false, error: "too large" });
      return {
        ok: true,
        path: resolved.publicPath,
        binary: true,
        bytes: st.size,
        truncated: true,
        offset_line: 0,
        note: `File larger than ${this.limits.maxReadBytes} bytes — not returned`,
      };
    }
    const buf = readFileSync(resolved.abs);
    if (isBinaryBuffer(buf)) {
      this.audit.record({ tool: "host_read", path: resolved.publicPath, ok: true });
      return {
        ok: true,
        path: resolved.publicPath,
        binary: true,
        bytes: buf.length,
        truncated: false,
        offset_line: 0,
        note: "Binary file — contents not returned",
      };
    }
    const text = buf.toString("utf8");
    const lines = text.split(/\n/);
    const start = Math.max(0, offsetLine);
    const take = Math.min(maxLines ?? this.limits.maxReadLines, this.limits.maxReadLines);
    const slice = lines.slice(start, start + take);
    const truncated = start + slice.length < lines.length || start > 0;
    this.audit.record({ tool: "host_read", path: resolved.publicPath, ok: true });
    return {
      ok: true,
      path: resolved.publicPath,
      binary: false,
      bytes: buf.length,
      truncated,
      offset_line: start,
      text: slice.join("\n"),
    };
  }

  search(query: string, pathPrefix?: string): HostSearchHit[] {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) {
      throw new HostError("query must be at least 2 characters");
    }
    const roots = pathPrefix?.trim()
      ? [resolvePublicPath(this.mounts, pathPrefix)]
      : this.mounts.map((m) => resolvePublicPath(this.mounts, m.alias));
    const hits: HostSearchHit[] = [];
    for (const root of roots) {
      this.walkSearch(root.abs, root.mount, needle, hits);
      if (hits.length >= this.limits.maxSearch) {
        break;
      }
    }
    this.audit.record({ tool: "host_search", path: pathPrefix || "(all)", ok: true });
    return hits;
  }

  private walkList(
    abs: string,
    mount: HostMount,
    depth: number,
    maxDepth: number,
    cap: number,
    out: HostListEntry[],
  ): void {
    if (out.length >= cap || depth > maxDepth) {
      return;
    }
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      return;
    }
    const rel = posixify(relative(mount.root, abs));
    if (rel && isSensitiveRel(rel)) {
      return;
    }
    const publicPath = rel ? `${mount.alias}/${rel}` : mount.alias;
    const type = st.isDirectory() ? "dir" : st.isFile() ? "file" : st.isSymbolicLink() ? "symlink" : "other";
    out.push({ path: publicPath, type, bytes: st.isFile() ? st.size : undefined, depth });
    if (!st.isDirectory() || depth >= maxDepth || out.length >= cap) {
      return;
    }
    let names: string[] = [];
    try {
      names = readdirSync(abs);
    } catch {
      return;
    }
    for (const name of names) {
      if (out.length >= cap) {
        return;
      }
      if (SKIP_DIRS.has(name.toLowerCase())) {
        continue;
      }
      const child = join(abs, name);
      let childReal: string;
      try {
        childReal = realpathSync(child);
      } catch {
        continue;
      }
      if (!staysInside(mount.root, childReal)) {
        continue;
      }
      this.walkList(child, mount, depth + 1, maxDepth, cap, out);
    }
  }

  private walkSearch(abs: string, mount: HostMount, needle: string, hits: HostSearchHit[]): void {
    if (hits.length >= this.limits.maxSearch) {
      return;
    }
    let names: string[] = [];
    try {
      names = readdirSync(abs);
    } catch {
      return;
    }
    for (const name of names) {
      if (hits.length >= this.limits.maxSearch) {
        return;
      }
      if (SKIP_DIRS.has(name.toLowerCase())) {
        continue;
      }
      const child = join(abs, name);
      let st;
      try {
        st = lstatSync(child);
      } catch {
        continue;
      }
      let childReal: string;
      try {
        childReal = realpathSync(child);
      } catch {
        continue;
      }
      if (!staysInside(mount.root, childReal)) {
        continue;
      }
      const rel = posixify(relative(mount.root, childReal));
      if (isSensitiveRel(rel) || isSensitiveRel(name)) {
        continue;
      }
      const publicPath = rel ? `${mount.alias}/${rel}` : mount.alias;
      if (name.toLowerCase().includes(needle) || rel.toLowerCase().includes(needle)) {
        hits.push({ path: publicPath, kind: "name" });
      }
      if (st.isDirectory() || (!st.isSymbolicLink() && !st.isFile() && lstatIsDir(childReal))) {
        if (st.isDirectory() || lstatIsDir(childReal)) {
          this.walkSearch(childReal, mount, needle, hits);
        }
        continue;
      }
      let fileSt;
      try {
        fileSt = statSync(childReal);
      } catch {
        continue;
      }
      if (!fileSt.isFile() || fileSt.size <= 0 || fileSt.size > this.limits.maxReadBytes) {
        continue;
      }
      let buf: Buffer;
      try {
        buf = readFileSync(childReal);
      } catch {
        continue;
      }
      if (isBinaryBuffer(buf)) {
        continue;
      }
      const text = buf.toString("utf8");
      const idx = text.toLowerCase().indexOf(needle);
      if (idx === -1) {
        continue;
      }
      const line = text.slice(0, idx).split(/\n/).length;
      const lineStart = text.lastIndexOf("\n", idx) + 1;
      const lineEnd = text.indexOf("\n", idx);
      const excerpt = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).slice(0, 200);
      hits.push({ path: publicPath, kind: "content", line, excerpt });
    }
  }
}

function lstatIsDir(abs: string): boolean {
  try {
    return lstatSync(abs).isDirectory();
  } catch {
    return false;
  }
}

function isBinaryFile(abs: string, cap: number): boolean {
  try {
    const buf = readFileSync(abs);
    return isBinaryBuffer(buf.subarray(0, Math.min(buf.length, 800, cap)));
  } catch {
    return true;
  }
}

function isBinaryBuffer(buf: Buffer): boolean {
  if (buf.includes(0)) {
    return true;
  }
  let suspicious = 0;
  const n = Math.min(buf.length, 800);
  for (let i = 0; i < n; i += 1) {
    const c = buf[i];
    if (c < 9 || (c > 13 && c < 32)) {
      suspicious += 1;
    }
  }
  return n > 0 && suspicious > n / 10;
}
