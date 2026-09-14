import type { OdooConfig, ServerConfig } from "./odoo.js";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type EnvMap = Record<string, string | undefined>;

const REQUIRED: (keyof ServerConfig)[] = ["url", "db", "username", "password"];

function validate(name: string, raw: unknown): ServerConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new ConfigError(`ODOO_SERVERS: server '${name}' must be an object`);
  }
  const config = raw as Record<string, unknown>;
  for (const key of REQUIRED) {
    if (typeof config[key] !== "string" || config[key] === "") {
      throw new ConfigError(`ODOO_SERVERS: server '${name}' is missing '${key}'`);
    }
  }
  return {
    url: (config.url as string).replace(/\/+$/, ""),
    db: config.db as string,
    username: config.username as string,
    password: config.password as string,
  };
}

export function loadConfig(env: EnvMap): OdooConfig {
  if (env.ODOO_SERVERS) {
    let parsed: { servers?: Record<string, unknown>; default_server?: unknown };
    try {
      parsed = JSON.parse(env.ODOO_SERVERS);
    } catch (cause) {
      throw new ConfigError(
        `ODOO_SERVERS is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    const entries = Object.entries(parsed.servers ?? {});
    if (entries.length === 0) {
      throw new ConfigError("ODOO_SERVERS contains no servers");
    }

    const servers: Record<string, ServerConfig> = {};
    for (const [name, raw] of entries) {
      servers[name] = validate(name, raw);
    }

    const requested = parsed.default_server;
    if (requested !== undefined && typeof requested !== "string") {
      throw new ConfigError("ODOO_SERVERS: 'default_server' must be a string");
    }
    if (requested !== undefined && !(requested in servers)) {
      throw new ConfigError(
        `ODOO_SERVERS: default_server '${requested}' is not one of: ${Object.keys(servers).join(", ")}`,
      );
    }

    return { servers, defaultServer: requested ?? entries[0][0] };
  }

  const { ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD } = env;
  if (ODOO_URL && ODOO_DB && ODOO_USERNAME && ODOO_PASSWORD) {
    return {
      servers: {
        default: validate("default", {
          url: ODOO_URL,
          db: ODOO_DB,
          username: ODOO_USERNAME,
          password: ODOO_PASSWORD,
        }),
      },
      defaultServer: "default",
    };
  }

  throw new ConfigError(
    "No Odoo server configured. Set ODOO_SERVERS, or all of " +
      "ODOO_URL / ODOO_DB / ODOO_USERNAME / ODOO_PASSWORD.",
  );
}

export function pickServer(
  config: OdooConfig,
  name?: string,
): { name: string; server: ServerConfig } {
  const resolved = name ?? config.defaultServer;
  const server = config.servers[resolved];
  if (!server) {
    throw new ConfigError(
      `Unknown server '${resolved}'. Available: ${Object.keys(config.servers).join(", ")}`,
    );
  }
  return { name: resolved, server };
}

export interface ModelPolicy {
  allow: string[];
  block: string[];
}

function parsePatterns(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function loadModelPolicy(env: EnvMap): ModelPolicy {
  return {
    allow: parsePatterns(env.ALLOWED_MODELS ?? env.ODOO_ALLOWED_MODELS),
    block: parsePatterns(env.BLOCKED_MODELS ?? env.ODOO_BLOCKED_MODELS),
  };
}

function matches(pattern: string, model: string): boolean {
  return pattern.endsWith("*") ? model.startsWith(pattern.slice(0, -1)) : pattern === model;
}

export function isModelAllowed(policy: ModelPolicy, model: string): boolean {
  if (policy.block.some((pattern) => matches(pattern, model))) {
    return false;
  }
  if (policy.allow.length === 0) {
    return true;
  }
  return policy.allow.some((pattern) => matches(pattern, model));
}

export function assertModelAllowed(policy: ModelPolicy, model: string): void {
  if (isModelAllowed(policy, model)) {
    return;
  }
  const reason = policy.block.some((pattern) => matches(pattern, model))
    ? "BLOCKED_MODELS"
    : "ALLOWED_MODELS";
  throw new ConfigError(`Model '${model}' is out of scope for this server (${reason}).`);
}
