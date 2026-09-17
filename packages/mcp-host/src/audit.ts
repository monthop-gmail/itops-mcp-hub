import { appendFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export class HostAudit {
  constructor(private readonly filePath: string | null) {}

  record(entry: { tool: string; path?: string; ok: boolean; error?: string }): void {
    if (!this.filePath) {
      return;
    }
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      try {
        const st = statSync(this.filePath);
        if (st.size > 1_000_000) {
          appendFileSync(this.filePath, `\n# rotated ${new Date().toISOString()}\n`, "utf8");
        }
      } catch {
        // first write
      }
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        ...entry,
      });
      appendFileSync(this.filePath, `${line}\n`, "utf8");
    } catch {
      // never fail a read because the audit file is not writable
    }
  }
}

export function auditPath(dir: string | undefined): string | null {
  if (!dir) {
    return null;
  }
  return join(dir, "host-audit.jsonl");
}
