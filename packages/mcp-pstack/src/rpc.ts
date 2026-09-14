import { healthUrl, mcpUrl } from "./policy.js";
import { PstackError, type PstackToolInfo } from "./types.js";

interface JsonRpcResponse {
  result?: unknown;
  error?: { code?: number; message?: string };
}

export interface PstackRpcConfig {
  baseUrl: string;
  apiKey: string;
  tenantId: string;
}

function authHeaders(config: PstackRpcConfig, tenantId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${config.apiKey}`,
  };
  const tenant = (tenantId || config.tenantId).trim();
  if (tenant) {
    headers["x-tenant-id"] = tenant;
  }
  return headers;
}

let rpcId = 1;

export async function pstackRpc<T>(
  config: PstackRpcConfig,
  method: string,
  params?: Record<string, unknown>,
  tenantId?: string,
): Promise<T> {
  const payload: Record<string, unknown> = {
    jsonrpc: "2.0",
    id: rpcId++,
    method,
  };
  if (params !== undefined) {
    payload.params = params;
  }

  let response: Response;
  try {
    response = await fetch(mcpUrl(config.baseUrl), {
      method: "POST",
      headers: authHeaders(config, tenantId),
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    throw new PstackError(
      `Cannot reach pstack at ${mcpUrl(config.baseUrl)}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  if (response.status === 401) {
    throw new PstackError("pstack returned HTTP 401 — check PSTACK_API_KEY (psk_...)");
  }
  if (!response.ok) {
    throw new PstackError(`pstack returned HTTP ${response.status} ${response.statusText} for /mcp`);
  }

  let body: JsonRpcResponse;
  try {
    body = (await response.json()) as JsonRpcResponse;
  } catch {
    throw new PstackError("pstack /mcp returned non-JSON — is PSTACK_URL pointing at a pstack instance?");
  }

  if (body.error) {
    throw new PstackError(body.error.message ?? `JSON-RPC error ${body.error.code ?? ""}`);
  }

  return body.result as T;
}

export interface PstackHealth {
  status?: string;
  app?: string;
  modules?: string[];
}

export async function pstackHealth(baseUrl: string): Promise<PstackHealth> {
  let response: Response;
  try {
    response = await fetch(healthUrl(baseUrl), { method: "GET" });
  } catch (cause) {
    throw new PstackError(
      `Cannot reach pstack healthz at ${healthUrl(baseUrl)}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (!response.ok) {
    throw new PstackError(`pstack healthz HTTP ${response.status}`);
  }
  return (await response.json()) as PstackHealth;
}

export interface InitializeResult {
  protocolVersion?: string;
  serverInfo?: { name?: string; version?: string };
  capabilities?: { tools?: unknown };
}

export interface ToolsListResult {
  tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
}

export interface ToolsCallResult {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}

export function asToolInfo(row: ToolsListResult["tools"][number]): PstackToolInfo {
  return {
    name: row.name,
    description: row.description ?? "",
    input_schema: row.inputSchema,
  };
}
