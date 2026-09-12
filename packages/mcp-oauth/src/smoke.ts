import { createHash, randomBytes } from "node:crypto";
import { createOauthApp } from "./app.js";

const IT = "it-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ADMIN = "admin-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ISSUER = "https://mcp-kknang.example.test";

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

async function main(): Promise<void> {
  const app = createOauthApp({ issuer: ISSUER, itToken: IT, adminToken: ADMIN });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("listen failed");
  }
  const base = `http://127.0.0.1:${addr.port}`;

  const asMeta = (await fetch(`${base}/.well-known/oauth-authorization-server`).then((r) =>
    r.json(),
  )) as { authorization_endpoint: string };
  if (asMeta.authorization_endpoint !== `${ISSUER}/authorize`) {
    throw new Error("authorization server metadata mismatch");
  }
  const pr = (await fetch(`${base}/.well-known/oauth-protected-resource/mcp/it/mcp`).then((r) =>
    r.json(),
  )) as { resource: string };
  if (pr.resource !== `${ISSUER}/mcp/it/mcp`) {
    throw new Error(`protected resource mismatch: ${pr.resource}`);
  }

  const registered = await fetch(`${base}/register`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://chatgpt.com" },
    body: JSON.stringify({
      client_name: "ChatGPT",
      redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  if (registered.status !== 201) {
    throw new Error(`register ${registered.status}: ${await registered.text()}`);
  }
  const client = (await registered.json()) as { client_id: string };
  const verifier = b64url(randomBytes(32));
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorizeUrl = new URL("/authorize", base);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", client.client_id);
  authorizeUrl.searchParams.set("redirect_uri", "https://chatgpt.com/connector_platform_oauth_redirect");
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", "st-1");
  authorizeUrl.searchParams.set("resource", `${ISSUER}/mcp/it/mcp`);

  const page = await fetch(authorizeUrl);
  const html = await page.text();
  if (page.status !== 200 || !html.includes("IT_TOKEN")) {
    throw new Error(`authorize page failed: ${page.status} ${html.slice(0, 200)}`);
  }

  const form = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
    state: "st-1",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${ISSUER}/mcp/it/mcp`,
    scope: "mcp:it",
    response_type: "code",
    token: IT,
  });
  const granted = await fetch(`${base}/authorize`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
    redirect: "manual",
  });
  const location = granted.headers.get("location") || "";
  if (granted.status !== 302 || !location.includes("code=")) {
    throw new Error(`authorize post ${granted.status} ${location} ${await granted.text()}`);
  }
  const code = new URL(location).searchParams.get("code");
  if (!code) {
    throw new Error("missing code");
  }

  const tokenRes = await fetch(`${base}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.client_id,
      code,
      redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
      code_verifier: verifier,
    }),
  });
  const tokenBody = (await tokenRes.json()) as { access_token?: string };
  if (tokenRes.status !== 200 || tokenBody.access_token !== IT) {
    throw new Error(`token exchange failed ${tokenRes.status} ${JSON.stringify(tokenBody)}`);
  }

  const itOnAdmin = await fetch(`${base}/authorize`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
      state: "st-2",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: `${ISSUER}/mcp/admin/mcp`,
      scope: "mcp:admin",
      response_type: "code",
      token: IT,
    }),
  });
  const denied = await itOnAdmin.text();
  if (!denied.includes("ADMIN_TOKEN")) {
    throw new Error("IT token should be rejected on admin resource");
  }

  server.close();
  console.log("oauth smoke ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
