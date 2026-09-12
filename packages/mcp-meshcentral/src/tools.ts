import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "@itops/mcp-common";
import { z } from "zod";
import { MeshCentralControlClient } from "./meshcentral-client.js";

export function registerMeshCentralTools(
  server: McpServer,
  client: MeshCentralControlClient,
  options: { allowShell: boolean },
): void {
  server.tool(
    "meshcentral_get_inventory",
    "Read MeshCentral cached node inventory from the control websocket (node id, name, OS, CPU, RAM, IP). Does not wake agents.",
    {},
    async () => {
      try {
        const nodes = await client.getInventory();
        return jsonResult({
          ok: true,
          count: nodes.length,
          nodes,
        });
      } catch (error) {
        return errorResult(
          `meshcentral_get_inventory failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  if (!options.allowShell) {
    return;
  }

  server.tool(
    "meshcentral_run_shell",
    "Admin only. Run a command on a MeshCentral agent through the control channel (PowerShell on Windows, POSIX shell on Linux). Uses cached inventory to resolve the node and choose the shell type.",
    {
      node_id: z
        .string()
        .min(1)
        .describe("MeshCentral node id (`node//...`) or exact device name from inventory."),
      command: z.string().min(1).describe("Command to run on the agent."),
    },
    async ({ node_id, command }) => {
      try {
        const result = await client.runShell(node_id, command);
        return jsonResult({ ok: true, ...result });
      } catch (error) {
        return errorResult(
          `meshcentral_run_shell failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
}
