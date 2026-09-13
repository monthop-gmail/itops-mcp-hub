import { readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "$recycle.bin",
  "system volume information",
  "thumbs",
]);

const MAX_BYTES = 40 * 1024 * 1024;

export interface WalkedFile {
  absPath: string;
  relPath: string;
  bytes: number;
  ext: string;
}

export function walkFiles(root: string): WalkedFile[] {
  const out: WalkedFile[] = [];
  visit(root, root, out);
  return out;
}

function visit(root: string, dir: string, out: WalkedFile[]): void {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith(".")) {
      continue;
    }
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name.toLowerCase())) {
        continue;
      }
      visit(root, abs, out);
      continue;
    }
    if (!st.isFile() || st.size <= 0 || st.size > MAX_BYTES) {
      continue;
    }
    out.push({
      absPath: abs,
      relPath: relative(root, abs).replaceAll("\\", "/"),
      bytes: st.size,
      ext: extname(name).toLowerCase() || "",
    });
  }
}
