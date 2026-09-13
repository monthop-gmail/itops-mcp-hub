import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { log, optionalEnv, serveMcpHttp } from "@itops/mcp-common";
import { RagCorpus } from "./corpus.js";
import { FIXTURE_NOTE, writeFixtureCorpus } from "./fixture.js";
import { registerRagTools } from "./tools.js";

const NAME = "sub-mcp-rag";
const VERSION = "1.0.0";

function createCorpus(): RagCorpus {
  const backend = (optionalEnv("RAG_BACKEND", "fixture") || "fixture").toLowerCase();
  if (backend === "files") {
    const dataDir = optionalEnv("RAG_DATA_DIR");
    if (!dataDir) {
      throw new Error("RAG_DATA_DIR is required when RAG_BACKEND=files");
    }
    const indexPath = optionalEnv("RAG_INDEX_PATH", join(dataDir, "..", "rag", "index.sqlite"));
    return new RagCorpus(
      "files",
      dataDir,
      indexPath,
      false,
      `อินเด็กซ์โฟลเดอร์ ${dataDir} ตาม path จริง — ไม่ต้องตัดโครงสร้างก่อน. PDF ใช้ pdftotext`,
    );
  }
  const dataDir = writeFixtureCorpus();
  const indexPath = join(dataDir, "index.sqlite");
  return new RagCorpus("fixture", dataDir, indexPath, true, FIXTURE_NOTE);
}

const corpus = createCorpus();
corpus.open();

function createServer(): McpServer {
  const server = new McpServer({ name: NAME, version: VERSION });
  registerRagTools(server, corpus);
  return server;
}

const port = Number(optionalEnv("PORT", "3000"));
log("info", "starting RAG MCP server", {
  port,
  backend: optionalEnv("RAG_BACKEND", "fixture"),
});

serveMcpHttp(createServer, {
  name: NAME,
  version: VERSION,
  port,
  publicBasePath: optionalEnv("MCP_PUBLIC_BASE_PATH"),
});

void corpus
  .reindex()
  .then((status) => {
    log("info", "RAG index ready", { ...status });
  })
  .catch((error) => {
    log("error", "RAG index failed", {
      err: error instanceof Error ? error.message : String(error),
    });
  });
