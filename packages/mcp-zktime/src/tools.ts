import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "@itops/mcp-common";
import { z } from "zod";
import { matchesQuery } from "./map.js";
import type { PunchKind, ZktimePunch, ZktimeStore } from "./types.js";

const querySchema = z
  .string()
  .min(1)
  .optional()
  .describe("ค้นหาชื่อหรือรหัสพนักงาน (ไม่สนตัวพิมพ์)");

const limitSchema = z.number().int().min(1).max(200).optional().describe("จำนวนแถวสูงสุด ค่าเริ่ม 50");

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .describe("วันที่ YYYY-MM-DD");

function clip<T>(rows: T[], limit: number | undefined): T[] {
  return rows.slice(0, limit ?? 50);
}

export function registerZktimeTools(server: McpServer, store: ZktimeStore): void {
  server.tool(
    "zktime_get_status",
    "สถานะการต่อ ZKTime 5 (เข้า-ออกงาน): โหมด fixture / mdb (att2000.mdb) / mssql",
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
    "zktime_inspect_schema",
    "รายชื่อตารางและคอลัมน์ ZKTime (ไม่มีข้อมูลแถว) สำหรับจับคู่ att2000 / SQL Server",
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
    "zktime_list_employees",
    "รายชื่อพนักงานจาก USERINFO (ไม่มี SSN / รหัสผ่าน / รูป / ลายนิ้วมือ)",
    { query: querySchema, limit: limitSchema },
    async (args) => {
      try {
        const status = await store.status();
        const rows = clip(
          (await store.listEmployees()).filter((row) =>
            matchesQuery(args.query, row.badge, row.name, row.user_id, row.department),
          ),
          args.limit,
        );
        return jsonResult({
          ok: true,
          backend: status.backend,
          sample: status.sample,
          count: rows.length,
          employees: rows,
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.tool(
    "zktime_list_punches",
    "รายการสแกนเข้า-ออกจาก CHECKINOUT (CHECKTYPE I=in, O=out). กรองวันที่ได้",
    {
      from: dateSchema,
      to: dateSchema,
      check_type: z.enum(["in", "out", "all"]).optional().describe("ค่าเริ่ม all"),
      query: querySchema,
      user_id: z.number().int().positive().optional().describe("USERID ใน USERINFO"),
      limit: z.number().int().min(1).max(500).optional().describe("จำนวนแถวสูงสุด ค่าเริ่ม 50"),
    },
    async (args) => {
      try {
        const status = await store.status();
        const wanted = (args.check_type ?? "all") as PunchKind | "all";
        const rows = clip(
          (await store.listPunches({
            from: args.from,
            to: args.to,
            query: args.query,
            user_id: args.user_id,
          })).filter((row: ZktimePunch) => wanted === "all" || row.check_type === wanted),
          args.limit,
        );
        return jsonResult({
          ok: true,
          backend: status.backend,
          sample: status.sample,
          count: rows.length,
          punches: rows,
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.tool(
    "zktime_list_departments",
    "แผนกจากตาราง DEPARTMENTS",
    { query: querySchema, limit: limitSchema },
    async (args) => {
      try {
        const status = await store.status();
        const rows = clip(
          (await store.listDepartments()).filter((row) => matchesQuery(args.query, row.name, row.id)),
          args.limit,
        );
        return jsonResult({
          ok: true,
          backend: status.backend,
          sample: status.sample,
          count: rows.length,
          departments: rows,
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.tool(
    "zktime_list_devices",
    "เครื่องสแกนจากตาราง Machines (ไม่มีรหัสสื่อสาร CommPassword)",
    { query: querySchema, limit: limitSchema },
    async (args) => {
      try {
        const status = await store.status();
        const rows = clip(
          (await store.listDevices()).filter((row) =>
            matchesQuery(args.query, row.alias, row.ip, row.serial, row.id),
          ),
          args.limit,
        );
        return jsonResult({
          ok: true,
          backend: status.backend,
          sample: status.sample,
          count: rows.length,
          devices: rows,
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );
}
