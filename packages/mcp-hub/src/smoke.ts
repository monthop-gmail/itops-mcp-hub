import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BackendMcpClient } from "./backend.js";
import { registerHostOnlyTools, registerHubTools, type HubBackends, type HubRole } from "./tools.js";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

async function list(role: HubRole, legalEnabled: boolean, githubEnabled = false): Promise<{ names: string[]; chunkHasPrefix: boolean }> {
  const fake = { async callTool() { throw new Error("not used in tools/list"); } } as unknown as BackendMcpClient;
  const backends: HubBackends = {
    zabbix: fake, meshcentral: fake, express: fake, zktime: fake, pstack: fake, rag: fake,
    legal: legalEnabled ? fake : undefined,
  };
  const server = new McpServer({ name: `test-${role}`, version: "1" });
  registerHubTools(server, backends, role, "express", false, false, legalEnabled, githubEnabled);
  const client = new Client({ name: "smoke", version: "1" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = (await client.listTools()).tools;
    const chunkSchema = tools.find((tool) => tool.name === "rag_get_chunk")?.inputSchema as { properties?: Record<string, unknown> } | undefined;
    return { names: tools.map((tool) => tool.name), chunkHasPrefix: Boolean(chunkSchema?.properties?.path_prefix) };
  } finally {
    await client.close();
    await server.close();
  }
}

for (const role of ["it", "admin", "accounting"] as const) {
  const offResult = await list(role, false);
  const off = offResult.names;
  const on = (await list(role, true)).names;
  assert(!off.some((name) => name.startsWith("legal_")), `${role} default-off`);
  assert(on.includes("legal_search") && on.includes("legal_ask"), `${role} enabled`);
  assert(on.filter((name) => name.startsWith("rag_")).length === off.filter((name) => name.startsWith("rag_")).length, `${role} existing RAG contract`);
  assert(!off.includes("rag_ingest_github_repo"), `${role} GitHub ingest default-off`);
  assert(offResult.chunkHasPrefix, `${role} must expose explicit GitHub boundary on chunk read`);
  const githubOn = (await list(role, false, true)).names;
  assert(githubOn.includes("rag_ingest_github_repo") === (role === "admin"), `${role} GitHub ingest admin-only`);
}
console.log("hub role legal/GitHub visibility/default-off smoke ok");

const fakeHost = { async callTool() { throw new Error("not used in tools/list"); } } as unknown as BackendMcpClient;
const hostServer = new McpServer({ name: "host-only-smoke", version: "1" });
registerHostOnlyTools(hostServer, { host: fakeHost });
const hostClient = new Client({ name: "host-only-smoke", version: "1" });
const [hostServerTransport, hostClientTransport] = InMemoryTransport.createLinkedPair();
try {
  await hostServer.connect(hostServerTransport);
  await hostClient.connect(hostClientTransport);
  const names = (await hostClient.listTools()).tools.map((tool) => tool.name).sort();
  assert(JSON.stringify(names) === JSON.stringify(["host_get_status", "host_list", "host_read", "host_search", "host_stat"].sort()), "host-only profile tools");
} finally {
  await hostClient.close();
  await hostServer.close();
}
console.log("hub host-only profile visibility smoke ok");
