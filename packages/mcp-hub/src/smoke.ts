import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BackendMcpClient } from "./backend.js";
import { registerHubTools, type HubBackends, type HubRole } from "./tools.js";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

async function list(role: HubRole, legalEnabled: boolean): Promise<string[]> {
  const fake = { async callTool() { throw new Error("not used in tools/list"); } } as unknown as BackendMcpClient;
  const backends: HubBackends = {
    zabbix: fake, meshcentral: fake, express: fake, zktime: fake, pstack: fake, rag: fake,
    legal: legalEnabled ? fake : undefined,
  };
  const server = new McpServer({ name: `test-${role}`, version: "1" });
  registerHubTools(server, backends, role, "express", false, false, legalEnabled);
  const client = new Client({ name: "smoke", version: "1" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return (await client.listTools()).tools.map((tool) => tool.name);
  } finally {
    await client.close();
    await server.close();
  }
}

for (const role of ["it", "admin", "accounting"] as const) {
  const off = await list(role, false);
  const on = await list(role, true);
  assert(!off.some((name) => name.startsWith("legal_")), `${role} default-off`);
  assert(on.includes("legal_search") && on.includes("legal_ask"), `${role} enabled`);
  assert(on.filter((name) => name.startsWith("rag_")).length === off.filter((name) => name.startsWith("rag_")).length, `${role} existing RAG contract`);
}
console.log("hub role legal visibility/default-off smoke ok");
