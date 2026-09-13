import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "@itops/mcp-common";
import { z } from "zod";
import type { ExpressBooks, ExpressInvoice, ExpressItem, ExpressParty, ExpressStore } from "./types.js";

const querySchema = z
  .string()
  .min(1)
  .optional()
  .describe("ค้นหารหัสหรือชื่อ (ไม่สนตัวพิมพ์)");

const limitSchema = z.number().int().min(1).max(200).optional().describe("จำนวนแถวสูงสุด ค่าเริ่ม 50");

function matchesQuery(query: string | undefined, ...fields: Array<string | undefined>): boolean {
  if (!query) {
    return true;
  }
  const needle = query.trim().toLowerCase();
  return fields.some((field) => (field ?? "").toLowerCase().includes(needle));
}

function clip<T>(rows: T[], limit: number | undefined): T[] {
  return rows.slice(0, limit ?? 50);
}

export function registerExpressTools(server: McpServer, store: ExpressStore): void {
  const load = async (): Promise<ExpressBooks> => store.load();

  server.tool(
    "express_get_status",
    "สถานะการต่อ Express Accounting (express.co.th): โหมด fixture / http / dbf และชื่อกิจการ",
    {},
    async () => {
      try {
        const books = await load();
        return jsonResult(books.status);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.tool(
    "express_list_customers",
    "รายชื่อลูกหนี้จากแฟ้ม ARMAS (หรือ HTTP /customers)",
    { query: querySchema, limit: limitSchema },
    async (args) => {
      try {
        const books = await load();
        const rows = clip(
          books.customers.filter((row: ExpressParty) => matchesQuery(args.query, row.code, row.name, row.tax_id)),
          args.limit,
        );
        return jsonResult({ ok: true, backend: books.status.backend, sample: books.status.sample, count: rows.length, customers: rows });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.tool(
    "express_list_vendors",
    "รายชื่อเจ้าหนี้จากแฟ้ม APMAS (หรือ HTTP /vendors)",
    { query: querySchema, limit: limitSchema },
    async (args) => {
      try {
        const books = await load();
        const rows = clip(
          books.vendors.filter((row: ExpressParty) => matchesQuery(args.query, row.code, row.name, row.tax_id)),
          args.limit,
        );
        return jsonResult({ ok: true, backend: books.status.backend, sample: books.status.sample, count: rows.length, vendors: rows });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.tool(
    "express_list_items",
    "รายการสินค้าจากแฟ้ม STMAS (หรือ HTTP /items)",
    { query: querySchema, limit: limitSchema },
    async (args) => {
      try {
        const books = await load();
        const rows = clip(
          books.items.filter((row: ExpressItem) => matchesQuery(args.query, row.code, row.name)),
          args.limit,
        );
        return jsonResult({ ok: true, backend: books.status.backend, sample: books.status.sample, count: rows.length, items: rows });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.tool(
    "express_list_ar_invoices",
    "ใบแจ้งหนี้ลูกหนี้จาก ARTRN (เปิดค้าง ค่าเริ่ม open). โหมด dbf อ่านอย่างเดียว ไม่รวมใบเสร็จ RECTYP 4",
    {
      status: z.enum(["open", "paid", "void", "all"]).optional().describe("ค่าเริ่ม open"),
      query: querySchema,
      limit: limitSchema,
    },
    async (args) => {
      try {
        const books = await load();
        const wanted = args.status ?? "open";
        const rows = clip(
          books.arInvoices.filter((row: ExpressInvoice) => {
            const statusOk = wanted === "all" || row.status === wanted;
            return statusOk && matchesQuery(args.query, row.doc_no, row.customer_code, row.customer_name);
          }),
          args.limit,
        );
        return jsonResult({
          ok: true,
          backend: books.status.backend,
          sample: books.status.sample,
          count: rows.length,
          invoices: rows,
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.tool(
    "express_list_gl_accounts",
    "ผังบัญชี / ยอด GL จากแฟ้ม GLMAS (หรือ HTTP /gl-accounts)",
    { query: querySchema, limit: limitSchema },
    async (args) => {
      try {
        const books = await load();
        const rows = clip(
          books.glAccounts.filter((row) => matchesQuery(args.query, row.code, row.name, row.type)),
          args.limit,
        );
        return jsonResult({ ok: true, backend: books.status.backend, sample: books.status.sample, count: rows.length, accounts: rows });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );
}
