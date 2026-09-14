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

export function jsonAndImageResult(
  data: unknown,
  image?: { mimeType: string; data: string },
  isError = false,
): CallToolResult {
  const content: CallToolResult["content"] = [
    { type: "text", text: JSON.stringify(data, null, 2) },
  ];
  if (image?.data) {
    content.push({
      type: "image",
      mimeType: image.mimeType,
      data: image.data,
    });
  }
  return { content, isError };
}

export function errorResult(message: string, details?: unknown): CallToolResult {
  const payload =
    details === undefined
      ? { ok: false, error: message }
      : { ok: false, error: message, details };
  return jsonResult(payload, true);
}
