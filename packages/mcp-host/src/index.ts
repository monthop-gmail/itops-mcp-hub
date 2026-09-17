import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { log, optionalEnv, serveMcpHttp } from "@itops/mcp-common";
import { HostAudit, auditPath } from "./audit.js";
import { FIXTURE_NOTE, writeFixtureHost } from "./fixture.js";
import { parseMounts, resolveMounts } from "./jail.js";
import { HostFs } from "./store.js";
import { registerHostTools } from "./tools.js";
import type { HostBackend, HostLimits } from "./types.js";

const NAME = "sub-mcp-host";
const VERSION = "1.0.0";

function parseBackend(raw: string): HostBackend {
  return raw.toLowerCase() === "files" ? "files" : "fixture";
}

function parseIntEnv(name: string, fallback: number): number {
  const n = Number(optionalEnv(name, String(fallback)));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function createFs(): HostFs {
  const backend = parseBackend(optionalEnv("HOST_BACKEND", "fixture"));
  const limits: HostLimits = {
    maxReadBytes: parseIntEnv("HOST_MAX_READ_BYTES", 1_048_576),
    maxList: parseIntEnv("HOST_MAX_LIST", 200),
    maxSearch: parseIntEnv("HOST_MAX_SEARCH", 50),
    maxDepth: parseIntEnv("HOST_MAX_DEPTH", 6),
    maxReadLines: parseIntEnv("HOST_MAX_READ_LINES", 200),
  };
  const audit = new HostAudit(auditPath(optionalEnv("HOST_AUDIT_DIR") || undefined));
  if (backend === "files") {
    const raw = optionalEnv("HOST_MOUNTS") || (optionalEnv("HOST_DATA_DIR") ? `ops:${optionalEnv("HOST_DATA_DIR")}` : "");
    if (!raw) {
      throw new Error("HOST_MOUNTS or HOST_DATA_DIR is required when HOST_BACKEND=files");
    }
    const mounts = resolveMounts(parseMounts(raw));
    if (mounts.length === 0) {
      throw new Error("HOST_MOUNTS resolved to zero mounts");
    }
    return new HostFs(
      "files",
      mounts,
      limits,
      false,
      "อ่านอย่างเดียวใต้โวลุ่มที่เมานต์เข้าคอนเทนเนอร์ — ไม่มีเชลล์ ไม่มีเขียน ไม่มี telemetry",
      audit,
    );
  }
  const root = writeFixtureHost();
  const mounts = resolveMounts([{ alias: "ops", root }]);
  return new HostFs("fixture", mounts, limits, true, FIXTURE_NOTE, audit);
}

const fs = createFs();

function createServer(): McpServer {
  const server = new McpServer({ name: NAME, version: VERSION });
  registerHostTools(server, fs);
  return server;
}

const port = Number(optionalEnv("PORT", "3000"));
log("info", "starting host MCP", {
  port,
  backend: fs.backend,
  mounts: fs.mounts.map((m) => m.alias),
  sample: fs.sample,
});
serveMcpHttp(createServer, {
  name: NAME,
  version: VERSION,
  port,
  publicBasePath: optionalEnv("MCP_PUBLIC_BASE_PATH"),
});
