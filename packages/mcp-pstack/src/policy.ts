import type { PstackToolInfo } from "./types.js";

export function stripUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function mcpUrl(base: string): string {
  return `${stripUrl(base)}/mcp`;
}

export function healthUrl(base: string): string {
  return `${stripUrl(base)}/healthz`;
}

function matches(pattern: string, name: string): boolean {
  return pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : pattern === name;
}

export function parseList(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Second fence on top of pstack RBAC. Empty allow = all names pstack already exposed. */
export function isToolAllowed(name: string, allow: string[], block: string[]): boolean {
  if (block.some((pattern) => matches(pattern, name))) {
    return false;
  }
  if (allow.length === 0) {
    return true;
  }
  return allow.some((pattern) => matches(pattern, name));
}

export const FIXTURE_TOOLS: PstackToolInfo[] = [
  {
    name: "search_faq",
    description: "ค้นหาคำถามที่พบบ่อย (FAQ) จากคำค้น",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "count_users",
    description: "นับจำนวนผู้ใช้ที่ active อยู่ในระบบ",
    input_schema: { type: "object", properties: {} },
  },
];

export function fixtureCall(name: string, args: Record<string, unknown>): string {
  if (name === "search_faq") {
    const query = String(args.query ?? "").toLowerCase();
    if (query && !query.includes("pstack") && !query.includes("mcp") && !query.includes("faq")) {
      return "ไม่พบ FAQ ที่ตรงกับคำค้นนี้";
    }
    return "Q: pstack คืออะไร\nA: Modular BaaS บน FastAPI ขยายด้วย addon สไตล์ Odoo — AI ภายนอกคุยผ่าน POST /mcp";
  }
  if (name === "count_users") {
    return "มีผู้ใช้ active 2 คน";
  }
  throw new Error(`unknown or unauthorized tool: ${name}`);
}
