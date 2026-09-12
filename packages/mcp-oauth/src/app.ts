import express, { type Request, type Response } from "express";
import { log } from "@itops/mcp-common";
import { randomToken, safeEqual, sha256Base64Url } from "./crypto-util.js";
import { renderAuthorizePage, renderSetupPage, renderSimpleError } from "./html.js";
import { isLoopbackHost, isTrustedRedirectUri } from "./redirects.js";
import {
  CODE_TTL_MS,
  MemoryStore,
  REFRESH_TTL_MS,
  type RegisteredClient,
} from "./store.js";

export interface OauthConfig {
  issuer: string;
  itToken: string;
  adminToken: string;
  accountingToken: string;
  accessTokenTtlSec?: number;
  publicClientId?: string;
  publicClientSecret?: string;
}

export type HubRole = "it" | "admin" | "accounting";

function jsonError(res: Response, status: number, error: string, detail?: string): void {
  res.status(status).json(detail ? { error, error_description: detail } : { error });
}

export function isRedirectUriAllowed(registered: string[], requested: string): boolean {
  if (isTrustedRedirectUri(requested)) {
    return true;
  }
  let req: URL;
  try {
    req = new URL(requested);
  } catch {
    return false;
  }
  const httpsOrLoopback =
    req.protocol === "https:" || (req.protocol === "http:" && isLoopbackHost(req.hostname));
  if (!httpsOrLoopback) {
    return false;
  }
  for (const raw of registered) {
    if (raw === requested) {
      return true;
    }
    let allowed: URL;
    try {
      allowed = new URL(raw);
    } catch {
      continue;
    }
    if (allowed.protocol !== req.protocol || allowed.hostname !== req.hostname) {
      continue;
    }
    if (allowed.pathname !== req.pathname) {
      continue;
    }
    if (isLoopbackHost(req.hostname)) {
      return true;
    }
    if ((allowed.port || "") === (req.port || "")) {
      return true;
    }
  }
  return false;
}

function roleHintFromResource(resource: string): "it" | "admin" | "accounting" | "either" {
  if (resource.includes("/mcp/admin")) {
    return "admin";
  }
  if (resource.includes("/mcp/accounting")) {
    return "accounting";
  }
  if (resource.includes("/mcp/it")) {
    return "it";
  }
  return "either";
}

function matchSiteToken(
  presented: string,
  config: OauthConfig,
): { role: HubRole; accessToken: string } | null {
  if (presented && safeEqual(presented, config.adminToken)) {
    return { role: "admin", accessToken: config.adminToken };
  }
  if (presented && safeEqual(presented, config.itToken)) {
    return { role: "it", accessToken: config.itToken };
  }
  if (presented && safeEqual(presented, config.accountingToken)) {
    return { role: "accounting", accessToken: config.accountingToken };
  }
  return null;
}

function cors(req: Request, res: Response, next: () => void): void {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, MCP-Protocol-Version, mcp-session-id, Last-Event-ID",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
  res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate, mcp-session-id");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}

function asMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    revocation_endpoint: `${issuer}/token`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["mcp:it", "mcp:admin", "mcp:accounting"],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: false,
  };
}

function protectedResource(issuer: string, resource: string, scopes: string[]) {
  return {
    resource,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: scopes,
  };
}

function clientNameOf(body: Record<string, unknown>): string {
  const name = body.client_name;
  return typeof name === "string" && name.trim() ? name.trim().slice(0, 120) : "MCP client";
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function formValue(req: Request, key: string): string {
  const body = req.body as Record<string, unknown> | undefined;
  const fromBody = body?.[key];
  if (typeof fromBody === "string") {
    return fromBody;
  }
  const fromQuery = req.query[key];
  return typeof fromQuery === "string" ? fromQuery : "";
}

function parseBasicClient(req: Request): { id?: string; secret?: string } {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Basic ")) {
    return {};
  }
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx < 0) {
      return { id: decoded };
    }
    return { id: decoded.slice(0, idx), secret: decoded.slice(idx + 1) };
  } catch {
    return {};
  }
}

export function createOauthApp(config: OauthConfig): express.Express {
  const issuer = config.issuer.replace(/\/+$/, "");
  const accessTtl = config.accessTokenTtlSec ?? 8 * 60 * 60;
  const publicClientId = config.publicClientId || "itops-public";
  const publicClientSecret = config.publicClientSecret || "itops-public-secret";
  const store = new MemoryStore();
  store.putClient({
    clientId: publicClientId,
    clientSecret: publicClientSecret,
    clientName: "ChatGPT / Grok / Gemini",
    redirectUris: [],
    tokenEndpointAuthMethod: "none",
    createdAt: Date.now(),
  });
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(cors);
  app.use(express.json({ limit: "32kb" }));
  app.use(express.urlencoded({ extended: false, limit: "32kb" }));

  setInterval(() => store.prune(), 60_000).unref();

  const isPublicClient = (clientId: string): boolean => clientId === publicClientId;

  const resolveClient = (
    clientId: string,
    redirectUri: string,
    clientName = "MCP client",
  ): RegisteredClient | undefined => {
    if (!clientId || !redirectUri) {
      return undefined;
    }
    let client = store.getClient(clientId);
    const trusted = isTrustedRedirectUri(redirectUri);
    if (!client) {
      if (!trusted) {
        return undefined;
      }
      client = {
        clientId,
        clientSecret: isPublicClient(clientId) ? publicClientSecret : null,
        clientName,
        redirectUris: [redirectUri],
        tokenEndpointAuthMethod: "none",
        createdAt: Date.now(),
      };
      store.putClient(client);
      log("info", "oauth client auto-provisioned", { clientId, redirectUri });
      return client;
    }
    if (!isRedirectUriAllowed(client.redirectUris, redirectUri)) {
      return undefined;
    }
    if (trusted && !client.redirectUris.includes(redirectUri)) {
      client.redirectUris.push(redirectUri);
    }
    return client;
  };

  const health = (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, service: "mcp-oauth", issuer });
  };
  app.get("/healthz", health);
  app.get("/health", health);

  app.get(
    /^\/\.well-known\/oauth-authorization-server(?:\/.*)?$/,
    (_req, res) => {
      res.status(200).json(asMetadata(issuer));
    },
  );
  app.get("/.well-known/openid-configuration", (_req, res) => {
    res.status(200).json(asMetadata(issuer));
  });

  app.get("/oauth/setup", (_req, res) => {
    res.status(200).type("html").send(
      renderSetupPage({
        issuer,
        mcpIt: `${issuer}/mcp/it/mcp`,
        mcpAccounting: `${issuer}/mcp/accounting/mcp`,
        clientId: publicClientId,
        clientSecret: publicClientSecret,
      }),
    );
  });

  app.get(/^\/\.well-known\/oauth-protected-resource(?:\/(.*))?$/, (req, res) => {
    const suffix = typeof req.params[0] === "string" ? req.params[0] : "";
    if (!suffix) {
      res.status(200).json(
        protectedResource(issuer, issuer, ["mcp:it", "mcp:admin", "mcp:accounting"]),
      );
      return;
    }
    const resourcePath = suffix.startsWith("/") ? suffix : `/${suffix}`;
    const resource = `${issuer}${resourcePath}`;
    const scopes = resourcePath.includes("/accounting")
      ? ["mcp:accounting"]
      : resourcePath.includes("/admin")
        ? ["mcp:admin"]
        : ["mcp:it"];
    res.status(200).json(protectedResource(issuer, resource, scopes));
  });

  app.post("/register", (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const redirectUris = stringList(body.redirect_uris);
    if (redirectUris.length === 0) {
      jsonError(res, 400, "invalid_client_metadata", "redirect_uris is required");
      return;
    }
    for (const uri of redirectUris) {
      if (!isRedirectUriAllowed(redirectUris, uri)) {
        jsonError(res, 400, "invalid_redirect_uri", "redirect_uri must be https or loopback http");
        return;
      }
    }
    const method =
      typeof body.token_endpoint_auth_method === "string"
        ? body.token_endpoint_auth_method
        : "none";
    const clientId = `itops-${randomToken(18)}`;
    const confidential = method !== "none";
    const clientSecret = confidential ? randomToken(32) : null;
    const client: RegisteredClient = {
      clientId,
      clientSecret,
      clientName: clientNameOf(body),
      redirectUris,
      tokenEndpointAuthMethod: method,
      createdAt: Date.now(),
    };
    store.putClient(client);
    log("info", "oauth client registered", {
      clientId,
      clientName: client.clientName,
      redirectUris: client.redirectUris,
    });
    res.status(201).json({
      client_id: clientId,
      client_secret: clientSecret ?? undefined,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: client.clientName,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: method,
      client_secret_expires_at: 0,
    });
  });

  const renderAuthorize = (req: Request, res: Response, error?: string) => {
    const clientId = formValue(req, "client_id");
    const redirectUri = formValue(req, "redirect_uri");
    const state = formValue(req, "state");
    const codeChallenge = formValue(req, "code_challenge");
    const codeChallengeMethod = formValue(req, "code_challenge_method") || "S256";
    const resource = formValue(req, "resource");
    const scope = formValue(req, "scope");
    const responseType = formValue(req, "response_type") || "code";

    if (!clientId || !redirectUri) {
      res
        .status(400)
        .type("html")
        .send(
          renderSimpleError(
            "คำขอ OAuth ไม่ครบ",
            "เปิดหน้านี้จาก ChatGPT / Grok / Gemini ตอนเชื่อม MCP ครั้งแรก — อย่าเปิด /authorize เปล่า ๆ",
          ),
        );
      return;
    }
    if (responseType !== "code") {
      jsonError(res, 400, "unsupported_response_type");
      return;
    }
    const publicish = isPublicClient(clientId) || isTrustedRedirectUri(redirectUri);
    if (!codeChallenge && !publicish) {
      res
        .status(400)
        .type("html")
        .send(
          renderSimpleError(
            "คำขอ OAuth ไม่ครบ",
            "ไคลเอนต์ต้องส่ง code_challenge (PKCE)",
          ),
        );
      return;
    }
    if (codeChallenge && codeChallengeMethod !== "S256") {
      jsonError(res, 400, "invalid_request", "code_challenge_method must be S256");
      return;
    }
    const client = resolveClient(clientId, redirectUri);
    if (!client) {
      jsonError(res, 400, "invalid_client", "Unknown client_id or redirect_uri is not allowed");
      return;
    }

    res.status(error ? 400 : 200).type("html").send(
      renderAuthorizePage({
        clientId,
        clientName: client.clientName,
        redirectUri,
        state,
        codeChallenge,
        codeChallengeMethod,
        resource,
        scope,
        responseType,
        roleHint: roleHintFromResource(resource),
        error,
      }),
    );
  };

  app.get("/authorize", (req, res) => {
    renderAuthorize(req, res);
  });

  app.post("/authorize", (req, res) => {
    const clientId = formValue(req, "client_id");
    const redirectUri = formValue(req, "redirect_uri");
    const state = formValue(req, "state");
    const codeChallenge = formValue(req, "code_challenge");
    const resource = formValue(req, "resource");
    const scope = formValue(req, "scope");
    const token = formValue(req, "token").trim();
    const client = resolveClient(clientId, redirectUri);
    if (!client || !codeChallenge && !isPublicClient(clientId) && !isTrustedRedirectUri(redirectUri)) {
      renderAuthorize(req, res, "คำขอหมดอายุหรือไม่ถูกต้อง — ให้ AI เชื่อมต่อใหม่");
      return;
    }
    const matched = matchSiteToken(token, config);
    if (!matched) {
      log("warn", "oauth authorize rejected (bad token)", { clientId });
      renderAuthorize(req, res, "โทเคนไม่ตรงกับไซต์นี้");
      return;
    }
    const hint = roleHintFromResource(resource);
    if (hint === "admin" && matched.role !== "admin") {
      renderAuthorize(req, res, "เส้น /mcp/admin ต้องใช้ ADMIN_TOKEN");
      return;
    }
    if (hint === "accounting" && matched.role !== "accounting") {
      renderAuthorize(req, res, "เส้น /mcp/accounting ต้องใช้ ACCOUNTING_TOKEN — ห้ามใช้โทเคน IT/admin");
      return;
    }
    if ((hint === "it" || hint === "admin") && matched.role === "accounting") {
      renderAuthorize(req, res, "ACCOUNTING_TOKEN ใช้ได้เฉพาะเส้น /mcp/accounting");
      return;
    }
    const issuedScope =
      matched.role === "admin"
        ? "mcp:admin"
        : matched.role === "accounting"
          ? "mcp:accounting"
          : scope.includes("mcp:admin")
            ? "mcp:it"
            : scope || "mcp:it";
    const code = randomToken(32);
    store.putCode({
      code,
      clientId,
      redirectUri,
      codeChallenge,
      resource,
      scope: issuedScope,
      accessToken: matched.accessToken,
      role: matched.role,
      expiresAt: Date.now() + CODE_TTL_MS,
    });
    const next = new URL(redirectUri);
    next.searchParams.set("code", code);
    if (state) {
      next.searchParams.set("state", state);
    }
    next.searchParams.set("iss", issuer);
    log("info", "oauth authorize granted", { clientId, role: matched.role });
    res.redirect(302, next.toString());
  });

  app.post("/token", (req, res) => {
    const grantType = formValue(req, "grant_type");
    const basic = parseBasicClient(req);
    const clientId = formValue(req, "client_id") || basic.id || "";
    const clientSecret = formValue(req, "client_secret") || basic.secret || "";
    const client = store.getClient(clientId);
    if (!client) {
      jsonError(res, 401, "invalid_client");
      return;
    }
    const publicish = isPublicClient(clientId);
    if (client.clientSecret && clientSecret && !safeEqual(clientSecret, client.clientSecret)) {
      jsonError(res, 401, "invalid_client");
      return;
    }
    if (client.clientSecret && !clientSecret && !publicish && client.tokenEndpointAuthMethod !== "none") {
      jsonError(res, 401, "invalid_client");
      return;
    }

    if (grantType === "authorization_code") {
      const code = formValue(req, "code");
      const redirectUri = formValue(req, "redirect_uri");
      const verifier = formValue(req, "code_verifier");
      const entry = store.takeCode(code);
      if (!entry || entry.clientId !== clientId || entry.redirectUri !== redirectUri) {
        jsonError(res, 400, "invalid_grant");
        return;
      }
      if (entry.expiresAt <= Date.now()) {
        jsonError(res, 400, "invalid_grant", "code expired");
        return;
      }
      if (entry.codeChallenge) {
        if (!verifier || sha256Base64Url(verifier) !== entry.codeChallenge) {
          jsonError(res, 400, "invalid_grant", "PKCE verification failed");
          return;
        }
      }
      const refreshToken = randomToken(32);
      store.putRefresh({
        refreshToken,
        clientId,
        accessToken: entry.accessToken,
        role: entry.role,
        resource: entry.resource,
        scope: entry.scope,
        expiresAt: Date.now() + REFRESH_TTL_MS,
      });
      res.status(200).json({
        access_token: entry.accessToken,
        token_type: "Bearer",
        expires_in: accessTtl,
        refresh_token: refreshToken,
        scope: entry.scope,
      });
      return;
    }

    if (grantType === "refresh_token") {
      const presented = formValue(req, "refresh_token");
      const entry = store.takeRefresh(presented);
      if (!entry || entry.clientId !== clientId || entry.expiresAt <= Date.now()) {
        jsonError(res, 400, "invalid_grant");
        return;
      }
      const refreshToken = randomToken(32);
      store.putRefresh({ ...entry, refreshToken, expiresAt: Date.now() + REFRESH_TTL_MS });
      res.status(200).json({
        access_token: entry.accessToken,
        token_type: "Bearer",
        expires_in: accessTtl,
        refresh_token: refreshToken,
        scope: entry.scope,
      });
      return;
    }

    jsonError(res, 400, "unsupported_grant_type");
  });

  return app;
}
