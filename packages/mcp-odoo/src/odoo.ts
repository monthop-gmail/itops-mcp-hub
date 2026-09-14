/**
 * Odoo JSON-RPC client on fetch — same execute_kw surface as
 * github.com/monthop-gmail/cf-odoo-mcp-server (Workers) and the Python XML-RPC original.
 * The hub already terminates TLS/OAuth, so this process talks to Odoo on the LAN or SaaS.
 */

export interface ServerConfig {
  url: string;
  db: string;
  username: string;
  password: string;
}

export interface OdooConfig {
  servers: Record<string, ServerConfig>;
  defaultServer: string;
}

export class OdooError extends Error {
  constructor(
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "OdooError";
  }
}

const uidCache = new Map<string, number>();

export function clearUidCache(): void {
  uidCache.clear();
}

interface JsonRpcResponse<T> {
  result?: T;
  error?: {
    message?: string;
    data?: { message?: string; name?: string; debug?: string };
  };
}

async function jsonRpc<T>(
  baseUrl: string,
  service: "common" | "object",
  method: string,
  args: unknown[],
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/jsonrpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        id: 1,
        params: { service, method, args },
      }),
    });
  } catch (cause) {
    throw new OdooError(
      `Cannot reach Odoo at ${baseUrl}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  if (!response.ok) {
    throw new OdooError(
      `Odoo returned HTTP ${response.status} ${response.statusText} for ${baseUrl}/jsonrpc`,
    );
  }

  let body: JsonRpcResponse<T>;
  try {
    body = (await response.json()) as JsonRpcResponse<T>;
  } catch {
    throw new OdooError(
      `Odoo returned a non-JSON response from ${baseUrl}/jsonrpc. ` +
        `Check that the URL points at an Odoo instance.`,
    );
  }

  if (body.error) {
    const detail = body.error.data?.message ?? body.error.message ?? "Unknown error";
    const name = body.error.data?.name;
    throw new OdooError(name ? `${name}: ${detail}` : detail, body.error.data);
  }

  return body.result as T;
}

async function getUid(name: string, config: ServerConfig): Promise<number> {
  const cached = uidCache.get(name);
  if (cached !== undefined) {
    return cached;
  }

  const uid = await jsonRpc<number | false>(config.url, "common", "authenticate", [
    config.db,
    config.username,
    config.password,
    {},
  ]);

  if (!uid) {
    throw new OdooError(
      `Authentication failed for user '${config.username}' on database '${config.db}'`,
    );
  }

  uidCache.set(name, uid);
  return uid;
}

export async function execute<T = unknown>(
  name: string,
  config: ServerConfig,
  model: string,
  method: string,
  args: unknown[] = [],
  kwargs: Record<string, unknown> = {},
): Promise<T> {
  const call = (uid: number) =>
    jsonRpc<T>(config.url, "object", "execute_kw", [
      config.db,
      uid,
      config.password,
      model,
      method,
      args,
      kwargs,
    ]);

  const uid = await getUid(name, config);
  try {
    return await call(uid);
  } catch (error) {
    if (!uidCache.has(name)) {
      throw error;
    }
    uidCache.delete(name);
    return await call(await getUid(name, config));
  }
}

export function version(config: ServerConfig): Promise<Record<string, unknown>> {
  return jsonRpc<Record<string, unknown>>(config.url, "common", "version", []);
}

/**
 * Group-and-aggregate across Odoo versions.
 * formatted_read_group is current (19 SaaS); read_group remains on older/self-hosted 19.0.
 */
export async function groupBy(
  key: string,
  server: ServerConfig,
  model: string,
  domain: unknown[],
  groupby: string[],
  aggregates: string[],
  kwargs: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await execute(key, server, model, "formatted_read_group", [domain, groupby, aggregates], kwargs);
  } catch (error) {
    const missing = error instanceof OdooError && /does not exist/.test(error.message);
    if (!missing) {
      throw error;
    }
    const fields = aggregates.filter((entry) => entry !== "__count").map((entry) => entry.split(":")[0]);
    return execute(key, server, model, "read_group", [domain, fields, groupby], {
      ...kwargs,
      lazy: false,
    });
  }
}
