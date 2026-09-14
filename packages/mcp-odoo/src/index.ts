import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { log, optionalEnv, serveMcpHttp } from "@itops/mcp-common";
import { createOdooRuntime, registerOdooTools } from "./tools.js";

const NAME = "sub-mcp-odoo";
const VERSION = "1.0.0";

function createServer(): McpServer {
  const runtime = createOdooRuntime();
  const server = new McpServer({ name: NAME, version: VERSION });
  registerOdooTools(server, runtime);
  return server;
}

const port = Number(optionalEnv("PORT", "3000"));
log("info", "starting Odoo MCP server", {
  port,
  backend: optionalEnv("ODOO_BACKEND", "fixture"),
  allowWrite: optionalEnv("ODOO_ALLOW_WRITE", "false"),
});
serveMcpHttp(createServer, {
  name: NAME,
  version: VERSION,
  port,
  publicBasePath: optionalEnv("MCP_PUBLIC_BASE_PATH"),
});
