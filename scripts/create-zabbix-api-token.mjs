#!/usr/bin/env node
/**
 * Create a Zabbix 7 API token for the MCP gateway.
 *
 * Usage (from the compose host, after Zabbix web is up):
 *   node scripts/create-zabbix-api-token.mjs
 *
 * Reads ZABBIX_WEB_LAN_PORT, ZABBIX_WEB_USER, ZABBIX_WEB_PASSWORD from `.env`.
 * Prints the token to stdout once; store it as ZABBIX_API_TOKEN.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv(path) {
  const env = {};
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return env;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const idx = trimmed.indexOf("=");
    if (idx === -1) {
      continue;
    }
    env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return env;
}

const fileEnv = loadDotEnv(resolve(process.cwd(), ".env"));
const port = fileEnv.ZABBIX_WEB_LAN_PORT || "9443";
const username = fileEnv.ZABBIX_WEB_USER || "Admin";
const password = fileEnv.ZABBIX_WEB_PASSWORD || "zabbix";
const url = process.env.ZABBIX_API_URL || `http://127.0.0.1:${port}/api_jsonrpc.php`;

async function rpc(method, params, auth) {
  const body = { jsonrpc: "2.0", method, params, id: Date.now() };
  if (auth) {
    body.auth = auth;
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json-rpc" },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (json.error) {
    throw new Error(`${method}: ${json.error.message}`);
  }
  return json.result;
}

const session = await rpc("user.login", { username, password });
const users = await rpc("user.get", { output: ["userid", "username"], filter: { username } }, session);
const userid = users[0]?.userid;
if (!userid) {
  throw new Error(`Could not resolve userid for ${username}`);
}
const created = await rpc(
  "token.create",
  { name: `mcp-gateway-${new Date().toISOString().slice(0, 10)}`, userid },
  session,
);
const tokenid = Array.isArray(created) ? created[0] : created;
const tokens = await rpc("token.get", { output: "extend", tokenids: [tokenid] }, session);
const token = tokens[0]?.token;
if (!token) {
  throw new Error("token.create succeeded but token string was not returned; check Zabbix version / permissions");
}
await rpc("user.logout", [], session);
process.stdout.write(`${token}\n`);
