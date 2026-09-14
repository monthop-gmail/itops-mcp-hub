import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonAndImageResult, jsonResult } from "@itops/mcp-common";
import { z } from "zod";
import type { RagCorpus } from "./corpus.js";
import { isOcrStatus } from "./ocr.js";

const querySchema = z.string().min(2).describe("คำค้นภาษาไทยหรือรหัสงบ/ชื่อไฟล์");
const limitSchema = z.number().int().min(1).max(30).optional().describe("จำนวนผลสูงสุด ค่าเริ่ม 8");
const prefixSchema = z
  .string()
  .min(1)
  .optional()
  .describe("กรอง path เช่น งบประมาณ-2570/กระทรวงมหาดไทย");
const jobIdSchema = z.number().int().positive().describe("id จาก rag_list_ocr_queue");

export function registerRagTools(server: McpServer, corpus: RagCorpus): void {
  server.tool(
    "rag_get_status",
    "สถานะคลังเอกสาร RAG: fixture หรือโฟลเดอร์จริง จำนวนไฟล์/ชิ้น คิว OCR และว่าอินเด็กซ์พร้อมหรือยัง",
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
    "สร้างอินเด็กซ์ใหม่จากโฟลเดอร์เอกสาร (อ่านอย่างเดียว ไม่ย้ายไฟล์) — คิว OCR ที่ approve/reject/done ไม่ถูกลบทิ้ง",
    {},
    async () => {
      try {
        return jsonResult(await corpus.reindex());
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.tool(
    "rag_ocr_status",
    "สรุปคิว OCR: จำนวน pending/approved/rejected/done และว่าส่งภาพออกจากไซต์หรือไม่ (ค่าเริ่มไม่ส่ง)",
    {},
    async () => jsonResult({ ok: true, ...corpus.status().ocr, sample: corpus.status().sample }),
  );

  server.tool(
    "rag_list_ocr_queue",
    "รายการงาน OCR (ค่าเริ่ม pending) — metadata/excerpt อย่างเดียว ไม่มีภาพ",
    {
      status: z
        .enum(["pending", "approved", "rejected", "done", "all"])
        .optional()
        .describe("ค่าเริ่ม pending"),
      path_prefix: prefixSchema,
      limit: z.number().int().min(1).max(100).optional(),
    },
    async (args) => {
      try {
        const status = args.status ?? "pending";
        const jobs = corpus.listOcrQueue(
          status === "all" ? "all" : isOcrStatus(status) ? status : "pending",
          args.path_prefix,
          args.limit ?? 40,
        );
        return jsonResult({
          ok: true,
          sample: corpus.status().sample,
          status,
          count: jobs.length,
          jobs,
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.tool(
    "rag_review_ocr_job",
    "คัดกรองงาน OCR: approve หรือ reject — ต้อง approve ก่อน rag_submit_ocr และก่อนส่งภาพ (ถ้าเปิดธงภาพ)",
    {
      job_id: jobIdSchema,
      action: z.enum(["approve", "reject"]),
      note: z.string().max(500).optional(),
    },
    async (args) => {
      try {
        const job = corpus.reviewOcrJob(args.job_id, args.action, args.note);
        return jsonResult({ ok: true, job });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.tool(
    "rag_get_ocr_page",
    "อ่าน metadata ของหน้าในคิว OCR — ภาพ JPEG ส่งเฉพาะเมื่อ RAG_OCR_INCLUDE_IMAGE=true และงานถูก approve แล้ว (คลาวด์ดึงไฟล์ LAN ไม่ได้)",
    { job_id: jobIdSchema },
    async (args) => {
      try {
        const page = await corpus.getOcrPage(args.job_id);
        const { image, ...meta } = page;
        return jsonAndImageResult(meta, image);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.tool(
    "rag_run_ocr",
    "ส่งหน้างานที่ approve แล้วไปค่าย OCR ที่ตั้งไว้ (ค่าเริ่ม Typhoon) — ไม่ทับ PDF. save=true จึงเขียน sidecar. ค่าเริ่มไม่ยิงทั้งคลัง",
    {
      job_id: jobIdSchema,
      provider: z.string().min(1).optional().describe("ค่าเริ่ม RAG_OCR_PROVIDER เช่น typhoon"),
      save: z.boolean().optional().describe("true = บันทึก sidecar หลังได้ข้อความ"),
    },
    async (args) => {
      try {
        const result = await corpus.runOcr(args.job_id, {
          provider: args.provider,
          save: args.save === true,
        });
        return jsonResult({
          ok: true,
          provider: result.provider,
          model: result.model,
          saved: result.saved,
          excerpt: result.excerpt,
          text: result.text,
          job: result.job,
          chunk_count: result.chunk_count,
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.tool(
    "rag_submit_ocr",
    "บันทึกข้อความ OCR เป็น sidecar ใต้โฟลเดอร์อินเด็กซ์ (ไม่ทับ PDF ต้นทาง) แล้วอินเด็กซ์หน้านี้ — ต้อง approve ก่อน",
    {
      job_id: jobIdSchema,
      text: z.string().min(1).max(200_000).describe("ข้อความที่อ่านจากหน้าสแกน"),
    },
    async (args) => {
      try {
        const result = corpus.submitOcr(args.job_id, args.text);
        return jsonResult({
          ok: true,
          job: result.job,
          chunk_count: result.chunk_count,
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );
}
