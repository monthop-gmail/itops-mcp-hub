import { log, optionalEnv, requireEnv } from "@itops/mcp-common";
import { createOauthApp } from "./app.js";

const itToken = requireEnv("IT_TOKEN");
const adminToken = requireEnv("ADMIN_TOKEN");
const accountingToken = requireEnv("ACCOUNTING_TOKEN");
if (itToken === adminToken || itToken === accountingToken || adminToken === accountingToken) {
  throw new Error("IT_TOKEN, ADMIN_TOKEN, and ACCOUNTING_TOKEN must all be different");
}

const hostname = optionalEnv("PUBLIC_MCP_HOSTNAME");
const issuer = optionalEnv(
  "PUBLIC_MCP_ORIGIN",
  hostname ? `https://${hostname}` : "http://127.0.0.1:9080",
).replace(/\/+$/, "");
const port = Number(optionalEnv("PORT", "3000"));
const app = createOauthApp({
  issuer,
  itToken,
  adminToken,
  accountingToken,
  publicClientId: optionalEnv("OAUTH_PUBLIC_CLIENT_ID", "itops-public"),
  publicClientSecret: optionalEnv("OAUTH_PUBLIC_CLIENT_SECRET", "itops-public-secret"),
});

app.listen(port, "0.0.0.0", () => {
  log("info", "MCP OAuth server listening", { port, issuer });
});
