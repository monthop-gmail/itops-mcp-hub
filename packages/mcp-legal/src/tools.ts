import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "@itops/mcp-common";
import { z } from "zod";
import type { LegalService } from "./service.js";

const asOf = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("วันที่ตรวจ YYYY-MM-DD; ค่าเริ่มวันนี้");

export function registerLegalTools(server: McpServer, service: LegalService): void {
  server.tool("legal_search", "ค้น corpus กฎหมายตัวอย่าง พร้อมมาตรา แหล่งที่มา วันที่ และ hash; read-only", {
    query: z.string().min(2).max(500), as_of: asOf, limit: z.number().int().min(1).max(10).optional(),
  }, async (args) => {
    try { return jsonResult(service.search(args.query, args.as_of ?? new Date().toISOString().slice(0, 10), args.limit)); }
    catch (error) { return errorResult(error instanceof Error ? error.message : String(error)); }
  });
  server.tool("legal_ask", "ค้นหลักฐานก่อนให้โมเดลร่างคำตอบ; ทุก claim ต้องมี quote/citation; ต้องให้คนรีวิว", {
    question: z.string().min(2).max(1000), as_of: asOf,
  }, async (args) => {
    try { return jsonResult(await service.ask(args.question, args.as_of ?? new Date().toISOString().slice(0, 10))); }
    catch (error) { return errorResult(error instanceof Error ? error.message : String(error)); }
  });
}
