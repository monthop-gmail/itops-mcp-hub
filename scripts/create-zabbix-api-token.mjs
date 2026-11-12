#!/usr/bin/env node
/**
 * Create a Zabbix 7 API token for the MCP gateway.
 *
 * Usage (from the compose host, after Zabbix web is up):
 *   node scripts/create-zabbix-api-token.mjs [--allow-admin]
 *
 * Reads ZABBIX_WEB_LAN_PORT, ZABBIX_WEB_USER, ZABBIX_WEB_PASSWORD from `.env`.
 * ZABBIX_WEB_USER must be a dedicated read-only user (role type User, Read on the needed host groups);
 * the token gets exactly that user's permissions. `Admin` is refused unless --allow-admin is given.
 * Prints the token to stdout once; store it as ZABBIX_API_TOKEN. The password is never printed.
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
const username = (fileEnv.ZABBIX_WEB_USER || "").trim();
const password = fileEnv.ZABBIX_WEB_PASSWORD || "";
const allowAdmin = process.argv.slice(2).includes("--allow-admin");

// Checked before any network call.
if (!username || !password) {
  process.stderr.write(
    "ZABBIX_WEB_USER and ZABBIX_WEB_PASSWORD must be set in .env.\n" +
      "Create a dedicated read-only Zabbix user for the MCP gateway (role type User, Read permission on the\n" +
      "host groups it should see; its role must allow managing API tokens), put its name and password in .env,\n" +
      "then run this script again. Do not use Admin.\n",
  );
  process.exit(1);
}
if (username.toLowerCase() === "admin") {
  if (!allowAdmin) {
    process.stderr.write(
      "Refusing to create a token for Admin: it would carry Super admin rights.\n" +
        "Use a dedicated read-only user, or pass --allow-admin if you really mean it.\n",
    );
    process.exit(1);
  }
  process.stderr.write("WARNING: --allow-admin given; this token will have Super admin rights. Prefer a read-only user.\n");
}

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
