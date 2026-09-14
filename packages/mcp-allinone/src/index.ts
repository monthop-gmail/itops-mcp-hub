import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { log, optionalEnv, serveMcpHttp } from "@itops/mcp-common";
import { createAllinoneStore } from "./store.js";
import { registerAllinoneTools } from "./tools.js";

const NAME = "sub-mcp-allinone";
const VERSION = "1.0.0";

function createServer(): McpServer {
  const store = createAllinoneStore();
  const server = new McpServer({ name: NAME, version: VERSION });
  registerAllinoneTools(server, store);
  return server;
}

const port = Number(optionalEnv("PORT", "3000"));
log("info", "starting Allinone Accounting MCP server", {
  port,
  backend: optionalEnv("ALLINONE_BACKEND", "fixture"),
});
serveMcpHttp(createServer, {
  name: NAME,
  version: VERSION,
  port,
  publicBasePath: optionalEnv("MCP_PUBLIC_BASE_PATH"),
});
