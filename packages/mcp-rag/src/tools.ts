import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "@itops/mcp-common";
import { z } from "zod";
import type { RagCorpus } from "./corpus.js";

const querySchema = z.string().min(2).describe("คำค้นภาษาไทยหรือรหัสงบ/ชื่อไฟล์");
const limitSchema = z.number().int().min(1).max(30).optional().describe("จำนวนผลสูงสุด ค่าเริ่ม 8");
const prefixSchema = z
  .string()
  .min(1)
  .optional()
  .describe("กรอง path เช่น งบประมาณ-2570/กระทรวงมหาดไทย");

export function registerRagTools(server: McpServer, corpus: RagCorpus): void {
  server.tool(
    "rag_get_status",
    "สถานะคลังเอกสาร RAG: fixture หรือโฟลเดอร์จริง จำนวนไฟล์/ชิ้น และว่าอินเด็กซ์พร้อมหรือยัง",
    {},
    async () => jsonResult(corpus.status()),
  );

  server.tool(
    "rag_list_sources",
    "รายการไฟล์ที่อินเด็กซ์แล้ว (ใช้ path เป็นโครงสร้าง — ไม่ต้องจัดโฟลเดอร์ใหม่)",
    { path_prefix: prefixSchema, limit: z.number().int().min(1).max(200).optional() },
    async (args) => {
      try {
        const sources = corpus.listSources(args.limit ?? 80, args.path_prefix);
        const status = corpus.status();
        return jsonResult({
          ok: true,
          sample: status.sample,
          count: sources.length,
          sources,
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.tool(
    "rag_search",
    "ค้นเอกสารงบประมาณ/ราชการในคลังท้องถิ่น คืน excerpt พร้อม path และเลขหน้า (ถ้ามี) เพื่อให้อ้างอิงได้",
    { query: querySchema, path_prefix: prefixSchema, limit: limitSchema },
    async (args) => {
      try {
        const hits = corpus.search(args.query, args.limit ?? 8, args.path_prefix);
        const status = corpus.status();
        return jsonResult({
          ok: true,
          sample: status.sample,
          query: args.query,
          count: hits.length,
          hits,
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.tool(
    "rag_get_chunk",
    "อ่านชิ้นข้อความเต็มจาก chunk_id ที่ได้จาก rag_search",
    { chunk_id: z.number().int().positive() },
    async (args) => {
      try {
        const chunk = corpus.getChunk(args.chunk_id);
        if (!chunk) {
          return errorResult(`ไม่พบ chunk_id ${args.chunk_id}`);
        }
        return jsonResult({ ok: true, sample: corpus.status().sample, chunk });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.tool(
    "rag_reindex",
    "สร้างอินเด็กซ์ใหม่จากโฟลเดอร์เอกสาร (อ่านอย่างเดียว ไม่ย้ายไฟล์)",
    {},
    async () => {
      try {
        return jsonResult(await corpus.reindex());
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );
}
