import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { log, optionalEnv, serveMcpHttp } from "@itops/mcp-common";
import { createExpressStore } from "./store.js";
import { registerExpressTools } from "./tools.js";

const NAME = "sub-mcp-express";
const VERSION = "1.0.0";

function createServer(): McpServer {
  const store = createExpressStore();
  const server = new McpServer({ name: NAME, version: VERSION });
  registerExpressTools(server, store);
  return server;
}

const port = Number(optionalEnv("PORT", "3000"));
log("info", "starting Express Accounting MCP server", {
  port,
  backend: optionalEnv("EXPRESS_BACKEND", "fixture"),
});
serveMcpHttp(createServer, {
  name: NAME,
  version: VERSION,
  port,
  publicBasePath: optionalEnv("MCP_PUBLIC_BASE_PATH"),
});
