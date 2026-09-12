import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function textResult(text: string, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text }],
    isError,
  };
}

export function jsonResult(data: unknown, isError = false): CallToolResult {
  return textResult(JSON.stringify(data, null, 2), isError);
}

export function errorResult(message: string, details?: unknown): CallToolResult {
  const payload =
    details === undefined
      ? { ok: false, error: message }
      : { ok: false, error: message, details };
  return jsonResult(payload, true);
}
