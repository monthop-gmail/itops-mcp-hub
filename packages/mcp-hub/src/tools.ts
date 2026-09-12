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

export type HubRole = "it" | "admin";

export function registerHubTools(
  server: McpServer,
  backends: { zabbix: BackendMcpClient; meshcentral: BackendMcpClient },
  role: HubRole,
): void {
  server.tool(
    "zabbix_get_active_problems",
    "Read currently active Zabbix problems, optionally filtered by minimum severity (0–5).",
    { severity_min: severityMin },
    async (args) => backends.zabbix.callTool("zabbix_get_active_problems", args),
  );

  server.tool(
    "zabbix_get_device_status",
    "Read Zabbix host/interface availability. Optional host group name (ESXi, Switches, CCTV, Windows servers, …).",
    {
      group_name: z.string().min(1).optional().describe("Optional Zabbix host group name."),
    },
    async (args) => backends.zabbix.callTool("zabbix_get_device_status", args),
  );

  server.tool(
    "zabbix_get_metrics",
    "Read latest Zabbix item values for one host and a list of item keys.",
    {
      host_name: z.string().min(1).describe("Zabbix technical or visible host name."),
      item_keys: z.array(z.string().min(1)).min(1).describe("Exact Zabbix item keys."),
    },
    async (args) => backends.zabbix.callTool("zabbix_get_metrics", args),
  );

  server.tool(
    "meshcentral_get_inventory",
    "Read MeshCentral cached node inventory (id, name, OS, CPU, RAM, IP).",
    {},
    async () => backends.meshcentral.callTool("meshcentral_get_inventory", {}),
  );

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
    async (args) => backends.meshcentral.callTool("meshcentral_run_shell", args),
  );
}
