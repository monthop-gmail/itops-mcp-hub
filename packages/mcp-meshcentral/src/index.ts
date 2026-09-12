import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { log, optionalEnv, requireEnv, serveMcpHttp } from "@itops/mcp-common";
import { MeshCentralControlClient } from "./meshcentral-client.js";
import { registerMeshCentralTools } from "./tools.js";

const NAME = "sub-mcp-meshcentral";
const VERSION = "1.0.0";

function createClient(): MeshCentralControlClient {
  const password = optionalEnv("MESHCENTRAL_PASSWORD") || requireEnv("MESHCENTRAL_API_KEY");
  return new MeshCentralControlClient({
    url: requireEnv("MESHCENTRAL_URL"),
    username: optionalEnv("MESHCENTRAL_USER", "admin"),
    password,
    totp: optionalEnv("MESHCENTRAL_2FA_TOKEN") || undefined,
    tlsInsecure: optionalEnv("MESHCENTRAL_TLS_INSECURE", "true") !== "false",
    requestTimeoutMs: Number(optionalEnv("MESHCENTRAL_TIMEOUT_MS", "20000")),
  });
}

const sharedClient = createClient();

function createServer(): McpServer {
  const allowShell = optionalEnv("MESHCENTRAL_ALLOW_SHELL", "true") === "true";
  const server = new McpServer({ name: NAME, version: VERSION });
  registerMeshCentralTools(server, sharedClient, { allowShell });
  return server;
}

const port = Number(optionalEnv("PORT", "3000"));
log("info", "starting MeshCentral MCP server", {
  port,
  url: optionalEnv("MESHCENTRAL_URL"),
  allowShell: optionalEnv("MESHCENTRAL_ALLOW_SHELL", "true"),
});

serveMcpHttp(createServer, {
  name: NAME,
  version: VERSION,
  port,
  publicBasePath: optionalEnv("MCP_PUBLIC_BASE_PATH"),
});

const shutdown = () => {
  sharedClient.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
