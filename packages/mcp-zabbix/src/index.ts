import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { log, optionalEnv, requireEnv, serveMcpHttp } from "@itops/mcp-common";
import { registerZabbixTools } from "./tools.js";
import { ZabbixClient } from "./zabbix-client.js";

const NAME = "sub-mcp-zabbix";
const VERSION = "1.0.0";

function createServer(): McpServer {
  const apiUrl = requireEnv("ZABBIX_API_URL");
  const apiToken = requireEnv("ZABBIX_API_TOKEN");
  const client = new ZabbixClient(apiUrl, apiToken);
  const server = new McpServer({ name: NAME, version: VERSION });
  registerZabbixTools(server, client);
  return server;
}

const port = Number(optionalEnv("PORT", "3000"));
log("info", "starting Zabbix MCP server", {
  port,
  apiUrl: optionalEnv("ZABBIX_API_URL"),
});
serveMcpHttp(createServer, {
  name: NAME,
  version: VERSION,
  port,
  publicBasePath: optionalEnv("MCP_PUBLIC_BASE_PATH"),
});
