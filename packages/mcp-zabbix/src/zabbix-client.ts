export interface ZabbixRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export class ZabbixClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly rpc?: ZabbixRpcError,
  ) {
    super(message);
    this.name = "ZabbixClientError";
  }
}

interface JsonRpcSuccess<T> {
  jsonrpc: "2.0";
  result: T;
  id: number | string;
}

interface JsonRpcFailure {
  jsonrpc: "2.0";
  error: ZabbixRpcError;
  id: number | string | null;
}

type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcFailure;

function isFailure<T>(body: JsonRpcResponse<T>): body is JsonRpcFailure {
  return "error" in body && body.error !== undefined;
}

export class ZabbixClient {
  constructor(
    private readonly apiUrl: string,
    private readonly apiToken: string,
    private readonly timeoutMs = 20_000,
  ) {}

  async call<T>(method: string, params: unknown = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(this.apiUrl, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json-rpc",
          Accept: "application/json",
          Authorization: `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method,
          params,
          id: Date.now(),
        }),
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new ZabbixClientError(
        aborted
          ? `Zabbix API timed out after ${this.timeoutMs}ms (${method})`
          : `Zabbix API request failed (${method}): ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.text();
    if (!response.ok) {
      throw new ZabbixClientError(
        `Zabbix API HTTP ${response.status} for ${method}: ${raw.slice(0, 500)}`,
        response.status,
      );
    }

    let body: JsonRpcResponse<T>;
    try {
      body = JSON.parse(raw) as JsonRpcResponse<T>;
    } catch {
      throw new ZabbixClientError(`Zabbix API returned non-JSON for ${method}: ${raw.slice(0, 500)}`);
    }

    if (isFailure(body)) {
      throw new ZabbixClientError(
        `Zabbix JSON-RPC ${method} error ${body.error.code}: ${body.error.message}`,
        response.status,
        body.error,
      );
    }

    return body.result;
  }
}

export const SEVERITY_NAMES = [
  "not_classified",
  "information",
  "warning",
  "average",
  "high",
  "disaster",
] as const;

export function severitiesFromMin(severityMin: number): number[] {
  const min = Math.max(0, Math.min(5, Math.trunc(severityMin)));
  return [0, 1, 2, 3, 4, 5].filter((value) => value >= min);
}
