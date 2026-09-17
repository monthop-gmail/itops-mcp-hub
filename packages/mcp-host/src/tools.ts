import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "@itops/mcp-common";
import { z } from "zod";
import type { HostFs } from "./store.js";
import { HostError } from "./types.js";

function fail(error: unknown) {
  const message = error instanceof HostError || error instanceof Error ? error.message : String(error);
  return errorResult(message);
}

export function registerHostTools(server: McpServer, fs: HostFs): void {
  server.tool(
    "host_get_status",
    "Admin only. สถานะ host MCP: โหมดอ่านอย่างเดียว, readable ของแต่ละ mount, uid ของโปรเซส (ไม่ใช่ root)",
    {},
    async () => jsonResult(fs.status()),
  );

  server.tool(
    "host_list",
    "Admin only. ลิสต์ไฟล์ใต้ mount ที่อนุญาต (อ่านอย่างเดียว ความลึกจำกัด)",
    {
      path: z.string().min(1).optional().describe("alias หรือ alias/relative เช่น ops/runbooks"),
      depth: z.number().int().min(0).max(8).optional().describe("ความลึก ค่าเริ่ม 2"),
      limit: z.number().int().min(1).max(200).optional(),
    },
    async (args) => {
      try {
        const entries = fs.list(args.path, args.depth ?? 2, args.limit);
        return jsonResult({ ok: true, count: entries.length, entries });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "host_stat",
    "Admin only. metadata ของไฟล์หรือโฟลเดอร์ใต้ mount (ไม่ตาม symlink ออกนอก jail)",
    {
      path: z.string().min(1).describe("alias/relative"),
    },
    async (args) => {
      try {
        return jsonResult(fs.stat(args.path));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "host_read",
    "Admin only. อ่านข้อความใต้ mount จำกัดบรรทัด/ไบต์ — ไม่คืนไบนารี และไม่ดึง URL",
    {
      path: z.string().min(1).describe("alias/relative"),
      offset_line: z.number().int().min(0).optional().describe("บรรทัดเริ่มต้น นับจาก 0"),
      max_lines: z.number().int().min(1).max(500).optional(),
    },
    async (args) => {
      try {
        return jsonResult(fs.read(args.path, args.offset_line ?? 0, args.max_lines));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "host_search",
    "Admin only. ค้นชื่อหรือเนื้อหาข้อความใต้ mount ที่อนุญาต",
    {
      query: z.string().min(2).describe("คำค้นอย่างน้อย 2 ตัวอักษร"),
      path_prefix: z.string().min(1).optional().describe("จำกัดใต้ alias/path"),
    },
    async (args) => {
      try {
        const hits = fs.search(args.query, args.path_prefix);
        return jsonResult({ ok: true, count: hits.length, hits });
      } catch (error) {
        return fail(error);
      }
    },
  );
}
