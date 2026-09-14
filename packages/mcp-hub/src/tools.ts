import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BackendMcpClient } from "./backend.js";

const severityMin = z
  .number()
  .int()
  .min(0)
  .max(5)
  .optional()
  .describe("Minimum problem severity. 0 Not classified … 5 Disaster.");

const expressQuery = z
  .string()
  .min(1)
  .optional()
  .describe("ค้นหารหัสหรือชื่อ (ไม่สนตัวพิมพ์)");

const expressLimit = z.number().int().min(1).max(200).optional().describe("จำนวนแถวสูงสุด ค่าเริ่ม 50");

export type HubRole = "it" | "admin" | "accounting";
export type AccountingProduct = "express" | "allinone" | "odoo";

export interface HubBackends {
  zabbix?: BackendMcpClient;
  meshcentral?: BackendMcpClient;
  express?: BackendMcpClient;
  allinone?: BackendMcpClient;
  odoo?: BackendMcpClient;
  zktime?: BackendMcpClient;
  pstack?: BackendMcpClient;
  rag?: BackendMcpClient;
}

export function registerHubTools(
  server: McpServer,
  backends: HubBackends,
  role: HubRole,
  accountingProduct: AccountingProduct = "express",
  odooAllowWrite = false,
): void {
  if (role === "accounting") {
    if (accountingProduct === "allinone") {
      registerAllinoneTools(server, requireBackend(backends.allinone, "allinone"));
    } else if (accountingProduct === "odoo") {
      registerOdooTools(server, requireBackend(backends.odoo, "odoo"), odooAllowWrite);
    } else {
      registerExpressTools(server, requireBackend(backends.express, "express"));
    }
    registerRagTools(server, requireBackend(backends.rag, "rag"));
    return;
  }

  const zabbix = requireBackend(backends.zabbix, "zabbix");
  const meshcentral = requireBackend(backends.meshcentral, "meshcentral");
  const zktime = requireBackend(backends.zktime, "zktime");
  const pstack = requireBackend(backends.pstack, "pstack");

  server.tool(
    "zabbix_get_active_problems",
    "Read currently active Zabbix problems, optionally filtered by minimum severity (0–5).",
    { severity_min: severityMin },
    async (args) => zabbix.callTool("zabbix_get_active_problems", args),
  );

  server.tool(
    "zabbix_get_device_status",
    "Read Zabbix host/interface availability. Optional host group name (ESXi, Switches, CCTV, Windows servers, …).",
    {
      group_name: z.string().min(1).optional().describe("Optional Zabbix host group name."),
    },
    async (args) => zabbix.callTool("zabbix_get_device_status", args),
  );

  server.tool(
    "zabbix_get_metrics",
    "Read latest Zabbix item values for one host and a list of item keys.",
    {
      host_name: z.string().min(1).describe("Zabbix technical or visible host name."),
      item_keys: z.array(z.string().min(1)).min(1).describe("Exact Zabbix item keys."),
    },
    async (args) => zabbix.callTool("zabbix_get_metrics", args),
  );

  server.tool(
    "meshcentral_get_inventory",
    "Read MeshCentral cached node inventory (id, name, OS, CPU, RAM, IP).",
    {},
    async () => meshcentral.callTool("meshcentral_get_inventory", {}),
  );

  registerZktimeTools(server, zktime);
  registerPstackTools(server, pstack);
  registerRagTools(server, requireBackend(backends.rag, "rag"));

  if (role !== "admin") {
    return;
  }

  server.tool(
    "meshcentral_run_shell",
    "Admin only. Run a command on a MeshCentral agent via the control channel.",
    {
      node_id: z.string().min(1).describe("MeshCentral node id or exact device name."),
      command: z.string().min(1).describe("Command to execute on the agent."),
    },
    async (args) => meshcentral.callTool("meshcentral_run_shell", args),
  );
}

function requireBackend(client: BackendMcpClient | undefined, name: string): BackendMcpClient {
  if (!client) {
    throw new Error(`MCP hub backend '${name}' is not configured`);
  }
  return client;
}

function registerRagTools(server: McpServer, rag: BackendMcpClient): void {
  server.tool(
    "rag_get_status",
    "สถานะคลังเอกสาร RAG (งบประมาณ/ราชการในโฟลเดอร์ท้องถิ่น)",
    {},
    async () => rag.callTool("rag_get_status", {}),
  );
  server.tool(
    "rag_list_sources",
    "รายการไฟล์ที่อินเด็กซ์แล้ว ใช้ path เป็นโครงสร้าง",
    {
      path_prefix: z.string().min(1).optional().describe("กรอง path"),
      limit: z.number().int().min(1).max(200).optional(),
    },
    async (args) => rag.callTool("rag_list_sources", args),
  );
  server.tool(
    "rag_search",
    "ค้นเอกสารในคลังท้องถิ่น คืน excerpt + path + หน้า สำหรับอ้างอิง",
    {
      query: z.string().min(2).describe("คำค้น"),
      path_prefix: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(30).optional(),
    },
    async (args) => rag.callTool("rag_search", args),
  );
  server.tool(
    "rag_get_chunk",
    "อ่านชิ้นข้อความเต็มจาก chunk_id ที่ได้จาก rag_search",
    { chunk_id: z.number().int().positive() },
    async (args) => rag.callTool("rag_get_chunk", args),
  );
  server.tool(
    "rag_reindex",
    "สร้างอินเด็กซ์ใหม่จากโฟลเดอร์เอกสาร (อ่านอย่างเดียว)",
    {},
    async () => rag.callTool("rag_reindex", {}),
  );
}

function registerExpressTools(server: McpServer, express: BackendMcpClient): void {
  server.tool(
    "express_get_status",
    "สถานะการต่อ Express Accounting (express.co.th): โหมด fixture / http / dbf และชื่อกิจการ",
    {},
    async () => express.callTool("express_get_status", {}),
  );

  server.tool(
    "express_list_customers",
    "รายชื่อลูกหนี้จากแฟ้ม ARMAS (หรือ HTTP /customers)",
    { query: expressQuery, limit: expressLimit },
    async (args) => express.callTool("express_list_customers", args),
  );

  server.tool(
    "express_list_vendors",
    "รายชื่อเจ้าหนี้จากแฟ้ม APMAS (หรือ HTTP /vendors)",
    { query: expressQuery, limit: expressLimit },
    async (args) => express.callTool("express_list_vendors", args),
  );

  server.tool(
    "express_list_items",
    "รายการสินค้าจากแฟ้ม STMAS (หรือ HTTP /items)",
    { query: expressQuery, limit: expressLimit },
    async (args) => express.callTool("express_list_items", args),
  );

  server.tool(
    "express_list_ar_invoices",
    "ใบแจ้งหนี้ลูกหนี้จาก ARTRN (เปิดค้าง ค่าเริ่ม open). โหมด dbf อ่านอย่างเดียว ไม่รวมใบเสร็จ RECTYP 4",
    {
      status: z.enum(["open", "paid", "void", "all"]).optional().describe("ค่าเริ่ม open"),
      query: expressQuery,
      limit: expressLimit,
    },
    async (args) => express.callTool("express_list_ar_invoices", args),
  );

  server.tool(
    "express_list_gl_accounts",
    "ผังบัญชี / ยอด GL จากแฟ้ม GLMAS (หรือ HTTP /gl-accounts)",
    { query: expressQuery, limit: expressLimit },
    async (args) => express.callTool("express_list_gl_accounts", args),
  );
}

function registerZktimeTools(server: McpServer, zktime: BackendMcpClient): void {
  const query = z.string().min(1).optional().describe("ค้นหาชื่อหรือรหัสพนักงาน (ไม่สนตัวพิมพ์)");
  const limit = z.number().int().min(1).max(200).optional().describe("จำนวนแถวสูงสุด ค่าเริ่ม 50");
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("วันที่ YYYY-MM-DD");

  server.tool(
    "zktime_get_status",
    "สถานะการต่อ ZKTime 5 (เข้า-ออกงาน): โหมด fixture / mdb / mssql",
    {},
    async () => zktime.callTool("zktime_get_status", {}),
  );
  server.tool(
    "zktime_inspect_schema",
    "รายชื่อตารางและคอลัมน์ ZKTime (ไม่มีข้อมูลแถว)",
    {},
    async () => zktime.callTool("zktime_inspect_schema", {}),
  );
  server.tool(
    "zktime_list_employees",
    "รายชื่อพนักงานจาก USERINFO (ไม่มี SSN / รหัสผ่าน / รูป / ลายนิ้วมือ)",
    { query, limit },
    async (args) => zktime.callTool("zktime_list_employees", args),
  );
  server.tool(
    "zktime_list_punches",
    "รายการสแกนเข้า-ออกจาก CHECKINOUT (I=in, O=out)",
    {
      from: date,
      to: date,
      check_type: z.enum(["in", "out", "all"]).optional().describe("ค่าเริ่ม all"),
      query,
      user_id: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
    async (args) => zktime.callTool("zktime_list_punches", args),
  );
  server.tool(
    "zktime_list_departments",
    "แผนกจากตาราง DEPARTMENTS",
    { query, limit },
    async (args) => zktime.callTool("zktime_list_departments", args),
  );
  server.tool(
    "zktime_list_devices",
    "เครื่องสแกนจากตาราง Machines (ไม่มีรหัสสื่อสาร CommPassword)",
    { query, limit },
    async (args) => zktime.callTool("zktime_list_devices", args),
  );
}

function registerPstackTools(server: McpServer, pstack: BackendMcpClient): void {
  server.tool(
    "pstack_get_status",
    "สถานะการต่อ pstack (fixture หรือ POST /mcp ของอินสแตนซ์จริง — ไม่ใช่เอเจนต์ในตัว)",
    {},
    async () => pstack.callTool("pstack_get_status", {}),
  );
  server.tool(
    "pstack_list_tools",
    "รายการ tool ที่ API key บน pstack ใช้ได้ โมดูลใหม่โผล่เอง",
    { query: z.string().min(1).optional() },
    async (args) => pstack.callTool("pstack_list_tools", args),
  );
  server.tool(
    "pstack_call_tool",
    "เรียก tool ของ pstack ตามชื่อจาก pstack_list_tools",
    {
      name: z.string().min(1),
      arguments: z.record(z.any()).optional(),
      tenant_id: z.string().min(1).optional(),
    },
    async (args) => pstack.callTool("pstack_call_tool", args),
  );
}

function registerAllinoneTools(server: McpServer, allinone: BackendMcpClient): void {
  server.tool(
    "allinone_get_status",
    "สถานะการต่อ Allinone (allinonesoft.com): โหมด fixture / mdb (VM) / mysql (CS)",
    {},
    async () => allinone.callTool("allinone_get_status", {}),
  );
  server.tool(
    "allinone_inspect_schema",
    "รายชื่อตารางและคอลัมน์ Allinone (ไม่มีข้อมูลแถว)",
    {},
    async () => allinone.callTool("allinone_inspect_schema", {}),
  );
  server.tool(
    "allinone_list_customers",
    "รายชื่อลูกหนี้จากตาราง ARMST",
    { query: expressQuery, limit: expressLimit },
    async (args) => allinone.callTool("allinone_list_customers", args),
  );
  server.tool(
    "allinone_list_vendors",
    "รายชื่อเจ้าหนี้จากตาราง APMST",
    { query: expressQuery, limit: expressLimit },
    async (args) => allinone.callTool("allinone_list_vendors", args),
  );
  server.tool(
    "allinone_list_items",
    "รายการสินค้าจากตาราง INVMST",
    { query: expressQuery, limit: expressLimit },
    async (args) => allinone.callTool("allinone_list_items", args),
  );
  server.tool(
    "allinone_list_ar_invoices",
    "ใบแจ้งหนี้ลูกหนี้จาก ARTR (ค่าเริ่ม open = ยังมี NBAL)",
    {
      status: z.enum(["open", "paid", "void", "all"]).optional().describe("ค่าเริ่ม open"),
      query: expressQuery,
      limit: expressLimit,
    },
    async (args) => allinone.callTool("allinone_list_ar_invoices", args),
  );
  server.tool(
    "allinone_list_gl_accounts",
    "ผังบัญชีจากตาราง GLMST",
    { query: expressQuery, limit: expressLimit },
    async (args) => allinone.callTool("allinone_list_gl_accounts", args),
  );
}

function registerOdooTools(server: McpServer, odoo: BackendMcpClient, allowWrite: boolean): void {
  const Domain = z
    .array(z.union([z.string(), z.array(z.any())]))
    .optional()
    .describe("Odoo search domain");
  const Model = z.string().describe("Odoo model name (e.g. res.partner)");
  const Ids = z.array(z.number().int());
  const ServerName = z.string().optional().describe("Named server from ODOO_SERVERS");

  server.tool("odoo_get_status", "สถานะการต่อ Odoo (fixture / jsonrpc)", {}, async () =>
    odoo.callTool("odoo_get_status", {}),
  );
  server.tool("odoo_list_servers", "รายชื่อเซิร์ฟเวอร์ Odoo ที่ตั้งไว้", {}, async () =>
    odoo.callTool("odoo_list_servers", {}),
  );
  server.tool(
    "odoo_version",
    "เวอร์ชัน Odoo",
    { server: ServerName },
    async (args) => odoo.callTool("odoo_version", args),
  );
  server.tool(
    "odoo_context",
    "ผู้ใช้ บริษัท timezone ภาษา — datetime ใน Odoo เป็น UTC",
    { server: ServerName },
    async (args) => odoo.callTool("odoo_context", args),
  );
  server.tool(
    "odoo_get_models",
    "รายชื่อโมเดลที่ใช้ได้ (ตัดที่โดน BLOCKED_MODELS)",
    {
      server: ServerName,
      filter: z.string().optional(),
      limit: z.number().int().optional(),
    },
    async (args) => odoo.callTool("odoo_get_models", args),
  );
  server.tool(
    "odoo_fields_get",
    "นิยามฟิลด์ของโมเดล",
    { server: ServerName, model: Model, attributes: z.array(z.string()).optional() },
    async (args) => odoo.callTool("odoo_fields_get", args),
  );
  server.tool(
    "odoo_search_count",
    "นับเรคอร์ดตามโดเมน",
    { server: ServerName, model: Model, domain: Domain },
    async (args) => odoo.callTool("odoo_search_count", args),
  );
  server.tool(
    "odoo_search_read",
    "ค้นแล้วอ่านเรคอร์ด (ค่าเริ่ม limit 50)",
    {
      server: ServerName,
      model: Model,
      domain: Domain,
      fields: z.array(z.string()).optional(),
      offset: z.number().int().optional(),
      limit: z.number().int().optional(),
      order: z.string().optional(),
    },
    async (args) => odoo.callTool("odoo_search_read", args),
  );
  server.tool(
    "odoo_read",
    "อ่านเรคอร์ดตาม id",
    { server: ServerName, model: Model, ids: Ids, fields: z.array(z.string()).optional() },
    async (args) => odoo.callTool("odoo_read", args),
  );
  server.tool(
    "odoo_read_group",
    "จัดกลุ่มแล้วรวมยอด — ถ้าถูกตัดจะมี has_more + total_records",
    {
      server: ServerName,
      model: Model,
      domain: Domain,
      groupby: z.array(z.string()),
      aggregates: z.array(z.string()).optional(),
      limit: z.number().int().optional(),
      offset: z.number().int().optional(),
      order: z.string().optional(),
    },
    async (args) => odoo.callTool("odoo_read_group", args),
  );

  if (!allowWrite) {
    return;
  }

  server.tool(
    "odoo_create",
    "สร้างเรคอร์ด (ต้องเปิด ODOO_ALLOW_WRITE) พร้อม fields_not_applied",
    { server: ServerName, model: Model, values: z.record(z.any()) },
    async (args) => odoo.callTool("odoo_create", args),
  );
  server.tool(
    "odoo_write",
    "แก้เรคอร์ด (ต้องเปิด ODOO_ALLOW_WRITE) พร้อม fields_not_applied",
    { server: ServerName, model: Model, ids: Ids, values: z.record(z.any()) },
    async (args) => odoo.callTool("odoo_write", args),
  );
  server.tool(
    "odoo_delete",
    "ลบเรคอร์ด (ต้องเปิด ODOO_ALLOW_WRITE)",
    { server: ServerName, model: Model, ids: Ids },
    async (args) => odoo.callTool("odoo_delete", args),
  );
  server.tool(
    "odoo_execute",
    "เรียก public method ใดก็ได้ (ต้องเปิด ODOO_ALLOW_WRITE)",
    {
      server: ServerName,
      model: Model,
      method: z.string(),
      args: z.array(z.any()).optional(),
      kwargs: z.record(z.any()).optional(),
    },
    async (args) => odoo.callTool("odoo_execute", args),
  );
}
