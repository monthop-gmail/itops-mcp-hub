import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { log, optionalEnv, requireEnv, serveMcpHttp } from "@itops/mcp-common";
import { BackendMcpClient } from "./backend.js";
import { registerHubTools, type HubRole } from "./tools.js";

const VERSION = "1.0.0";

function parseRole(raw: string): HubRole {
  if (raw === "it" || raw === "admin") {
    return raw;
  }
  throw new Error(`HUB_ROLE must be 'it' or 'admin' (got '${raw}')`);
}

const role = parseRole(optionalEnv("HUB_ROLE", "it"));
const name = role === "admin" ? "mcp-hub-admin" : "mcp-hub-it";

const zabbix = new BackendMcpClient("zabbix", requireEnv("ZABBIX_MCP_URL"));
const meshcentral = new BackendMcpClient("meshcentral", requireEnv("MESHCENTRAL_MCP_URL"));

function createServer(): McpServer {
  const server = new McpServer({ name, version: VERSION });
  registerHubTools(server, { zabbix, meshcentral }, role);
  return server;
}

const port = Number(optionalEnv("PORT", "3000"));
log("info", "starting MCP hub", {
  name,
  role,
  port,
  zabbix: optionalEnv("ZABBIX_MCP_URL"),
  meshcentral: optionalEnv("MESHCENTRAL_MCP_URL"),
  publicBasePath: optionalEnv("MCP_PUBLIC_BASE_PATH"),
});

serveMcpHttp(createServer, {
  name,
  version: VERSION,
  port,
  publicBasePath: optionalEnv("MCP_PUBLIC_BASE_PATH"),
});
