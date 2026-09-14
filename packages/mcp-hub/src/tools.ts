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
export type AccountingProduct = "express" | "allinone";

export interface HubBackends {
  zabbix?: BackendMcpClient;
  meshcentral?: BackendMcpClient;
  express?: BackendMcpClient;
  allinone?: BackendMcpClient;
  rag?: BackendMcpClient;
}

export function registerHubTools(
  server: McpServer,
  backends: HubBackends,
  role: HubRole,
  accountingProduct: AccountingProduct = "express",
): void {
  if (role === "accounting") {
    if (accountingProduct === "allinone") {
      registerAllinoneTools(server, requireBackend(backends.allinone, "allinone"));
    } else {
      registerExpressTools(server, requireBackend(backends.express, "express"));
    }
    registerRagTools(server, requireBackend(backends.rag, "rag"));
    return;
  }

  const zabbix = requireBackend(backends.zabbix, "zabbix");
  const meshcentral = requireBackend(backends.meshcentral, "meshcentral");

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
