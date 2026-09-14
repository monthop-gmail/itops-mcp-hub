import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { log, optionalEnv, serveMcpHttp } from "@itops/mcp-common";
import { createPstackStore } from "./store.js";
import { registerPstackTools } from "./tools.js";

const NAME = "sub-mcp-pstack";
const VERSION = "1.0.0";

function createServer(): McpServer {
  const store = createPstackStore();
  const server = new McpServer({ name: NAME, version: VERSION });
  registerPstackTools(server, store);
  return server;
}

const port = Number(optionalEnv("PORT", "3000"));
log("info", "starting pstack MCP bridge", {
  port,
  backend: optionalEnv("PSTACK_BACKEND", "fixture"),
  url: optionalEnv("PSTACK_URL") ? "(set)" : "",
});
serveMcpHttp(createServer, {
  name: NAME,
  version: VERSION,
  port,
  publicBasePath: optionalEnv("MCP_PUBLIC_BASE_PATH"),
});
