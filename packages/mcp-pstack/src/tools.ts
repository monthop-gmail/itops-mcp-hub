import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "@itops/mcp-common";
import { z } from "zod";
import type { PstackStore } from "./types.js";

export function registerPstackTools(server: McpServer, store: PstackStore): void {
  server.tool(
    "pstack_get_status",
    "สถานะการต่อ pstack: fixture หรือ HTTP ไปที่ POST /mcp ของอินสแตนซ์จริง (ไม่ใช่เอเจนต์ในตัว)",
    {},
    async () => {
      try {
        return jsonResult(await store.status());
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.tool(
    "pstack_list_tools",
    "รายการ tool ที่ API key บน pstack ใช้ได้ (กรอง RBAC ฝั่ง pstack + allow/block ของฮับ). โมดูลใหม่โผล่ที่นี่เอง",
    {
      query: z.string().min(1).optional().describe("กรองชื่อหรือคำอธิบาย"),
    },
    async (args) => {
      try {
        const status = await store.status();
        const tools = await store.listTools(args.query);
        return jsonResult({
          ok: true,
          backend: status.backend,
          sample: status.sample,
          count: tools.length,
          tools,
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.tool(
    "pstack_call_tool",
    "เรียก tool ของ pstack ตามชื่อจาก pstack_list_tools. ส่ง X-Tenant-Id ได้ต่อครั้ง. ไม่เรียกแชทเอเจนต์ Claude ใน pstack",
    {
      name: z.string().min(1).describe("ชื่อ tool บน pstack เช่น search_faq"),
      arguments: z.record(z.any()).optional().describe("อาร์กิวเมนต์ตาม inputSchema ของ tool นั้น"),
      tenant_id: z.string().min(1).optional().describe("ทับ PSTACK_TENANT_ID เป็น X-Tenant-Id"),
    },
    async (args) => {
      try {
        const result = await store.callTool(args.name, args.arguments ?? {}, args.tenant_id);
        return jsonResult(result, result.is_error);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );
}
