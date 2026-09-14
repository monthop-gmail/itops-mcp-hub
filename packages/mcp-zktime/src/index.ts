import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { log, optionalEnv, serveMcpHttp } from "@itops/mcp-common";
import { createZktimeStore } from "./store.js";
import { registerZktimeTools } from "./tools.js";

const NAME = "sub-mcp-zktime";
const VERSION = "1.0.0";

function createServer(): McpServer {
  const store = createZktimeStore();
  const server = new McpServer({ name: NAME, version: VERSION });
  registerZktimeTools(server, store);
  return server;
}

const port = Number(optionalEnv("PORT", "3000"));
log("info", "starting ZKTime attendance MCP server", {
  port,
  backend: optionalEnv("ZKTIME_BACKEND", "fixture"),
});
serveMcpHttp(createServer, {
  name: NAME,
  version: VERSION,
  port,
  publicBasePath: optionalEnv("MCP_PUBLIC_BASE_PATH"),
});
