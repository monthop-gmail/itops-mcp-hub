import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { log, optionalEnv, requireEnv, serveMcpHttp } from "@itops/mcp-common";
import { BackendMcpClient } from "./backend.js";
import { registerHubTools, type AccountingProduct, type HubBackends, type HubRole } from "./tools.js";

const VERSION = "1.0.0";

function parseRole(raw: string): HubRole {
  if (raw === "it" || raw === "admin" || raw === "accounting") {
    return raw;
  }
  throw new Error(`HUB_ROLE must be 'it', 'admin', or 'accounting' (got '${raw}')`);
}

function hubName(role: HubRole): string {
  if (role === "admin") {
    return "mcp-hub-admin";
  }
  if (role === "accounting") {
    return "mcp-hub-accounting";
  }
  return "mcp-hub-it";
}

const role = parseRole(optionalEnv("HUB_ROLE", "it"));
const name = hubName(role);

function parseAccountingProduct(raw: string): AccountingProduct {
  return raw === "allinone" ? "allinone" : "express";
}

const accountingProduct = parseAccountingProduct(optionalEnv("ACCOUNTING_PRODUCT", "express"));

function createBackends(): HubBackends {
  const rag = new BackendMcpClient("rag", requireEnv("RAG_MCP_URL"));
  if (role === "accounting") {
    if (accountingProduct === "allinone") {
      return { allinone: new BackendMcpClient("allinone", requireEnv("ALLINONE_MCP_URL")), rag };
    }
    return { express: new BackendMcpClient("express", requireEnv("EXPRESS_MCP_URL")), rag };
  }
  return {
    zabbix: new BackendMcpClient("zabbix", requireEnv("ZABBIX_MCP_URL")),
    meshcentral: new BackendMcpClient("meshcentral", requireEnv("MESHCENTRAL_MCP_URL")),
    rag,
  };
}

const backends = createBackends();

function createServer(): McpServer {
  const server = new McpServer({ name, version: VERSION });
  registerHubTools(server, backends, role, accountingProduct);
  return server;
}

const port = Number(optionalEnv("PORT", "3000"));
log("info", "starting MCP hub", {
  name,
  role,
  port,
  zabbix: optionalEnv("ZABBIX_MCP_URL"),
  meshcentral: optionalEnv("MESHCENTRAL_MCP_URL"),
  express: optionalEnv("EXPRESS_MCP_URL"),
  allinone: optionalEnv("ALLINONE_MCP_URL"),
  accountingProduct,
  rag: optionalEnv("RAG_MCP_URL"),
  publicBasePath: optionalEnv("MCP_PUBLIC_BASE_PATH"),
});

serveMcpHttp(createServer, {
  name,
  version: VERSION,
  port,
  publicBasePath: optionalEnv("MCP_PUBLIC_BASE_PATH"),
});
