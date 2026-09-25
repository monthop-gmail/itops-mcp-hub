import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { log, optionalEnv, serveMcpHttp } from "@itops/mcp-common";
import { createInference } from "./inference.js";
import { LegalService } from "./service.js";
import { registerLegalTools } from "./tools.js";

const NAME = "sub-mcp-legal";
const VERSION = "0.1.0";
const service = new LegalService(createInference());

function createServer(): McpServer {
  const server = new McpServer({ name: NAME, version: VERSION });
  registerLegalTools(server, service);
  return server;
}

const port = Number(optionalEnv("PORT", "3000"));
log("info", "starting legal fixture MCP", { port, backend: optionalEnv("LEGAL_INFERENCE_BACKEND", "retrieval-only") });
serveMcpHttp(createServer, { name: NAME, version: VERSION, port });
