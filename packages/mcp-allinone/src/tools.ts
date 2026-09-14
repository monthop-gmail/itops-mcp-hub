import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "@itops/mcp-common";
import { z } from "zod";
import type { AllinoneBooks, AllinoneInvoice, AllinoneStore } from "./types.js";

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

export function registerAllinoneTools(server: McpServer, store: AllinoneStore): void {
  const load = async (): Promise<AllinoneBooks> => store.load();

  server.tool(
    "allinone_get_status",
    "สถานะการต่อ Allinone (allinonesoft.com): โหมด fixture / mdb (VM) / mysql (CS) และชื่อกิจการ",
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
    "allinone_inspect_schema",
    "รายชื่อตารางและคอลัมน์ (ไม่มีข้อมูลแถว) สำหรับจับคู่สมุด Allinone CS/VM",
    {},
    async () => {
      try {
        if (!store.inspect) {
          return errorResult("inspect is not available on this backend");
        }
        const schema = await store.inspect();
        return jsonResult({
          ok: true,
          backend: store.kind,
          table_count: schema.tables.length,
          tables: schema.tables,
          mapped_columns: schema.columns,
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.tool(
    "allinone_list_customers",
    "รายชื่อลูกหนี้จากตาราง ARMST",
    { query: querySchema, limit: limitSchema },
    async (args) => {
      try {
        const books = await load();
        const rows = clip(
          books.customers.filter((row) => matchesQuery(args.query, row.code, row.name, row.tax_id, row.contact)),
          args.limit,
        );
        return jsonResult({
          ok: true,
          backend: books.status.backend,
          sample: books.status.sample,
          count: rows.length,
          customers: rows,
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.tool(
    "allinone_list_vendors",
    "รายชื่อเจ้าหนี้จากตาราง APMST",
    { query: querySchema, limit: limitSchema },
    async (args) => {
      try {
        const books = await load();
        const rows = clip(
          books.vendors.filter((row) => matchesQuery(args.query, row.code, row.name, row.tax_id, row.contact)),
          args.limit,
        );
        return jsonResult({
          ok: true,
          backend: books.status.backend,
          sample: books.status.sample,
          count: rows.length,
          vendors: rows,
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.tool(
    "allinone_list_items",
    "รายการสินค้าจากตาราง INVMST",
    { query: querySchema, limit: limitSchema },
    async (args) => {
      try {
        const books = await load();
        const rows = clip(
          books.items.filter((row) => matchesQuery(args.query, row.code, row.name)),
          args.limit,
        );
        return jsonResult({
          ok: true,
          backend: books.status.backend,
          sample: books.status.sample,
          count: rows.length,
          items: rows,
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.tool(
    "allinone_list_ar_invoices",
    "ใบแจ้งหนี้ลูกหนี้จาก ARTR (ค่าเริ่ม open = ยังมี NBAL). อ่านอย่างเดียว ไม่รวมใบเสร็จ RC/RE",
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
          books.arInvoices.filter((row: AllinoneInvoice) => {
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
    "allinone_list_gl_accounts",
    "ผังบัญชีจากตาราง GLMST",
    { query: querySchema, limit: limitSchema },
    async (args) => {
      try {
        const books = await load();
        const rows = clip(
          books.glAccounts.filter((row) => matchesQuery(args.query, row.code, row.name, row.type)),
          args.limit,
        );
        return jsonResult({
          ok: true,
          backend: books.status.backend,
          sample: books.status.sample,
          count: rows.length,
          accounts: rows,
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );
}
