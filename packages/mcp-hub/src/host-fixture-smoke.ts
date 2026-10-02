import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function main(): Promise<void> {
  const client = new Client({ name: "host-fixture-profile-smoke", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:3000/mcp")));
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
    const expected = ["host_get_status", "host_list", "host_read", "host_search", "host_stat"].sort();
    assert(JSON.stringify(names) === JSON.stringify(expected), `unexpected tools: ${names.join(",")}`);
    const status = await client.callTool({ name: "host_get_status", arguments: {} }) as CallToolResult;
    assert(!status.isError && status.content.some((item) => item.type === "text" && item.text.includes('"sample": true')), "fixture status");
    const read = await client.callTool({ name: "host_read", arguments: { path: "ops/README.md" } }) as CallToolResult;
    assert(!read.isError && read.content.some((item) => item.type === "text" && item.text.includes("Host fixture")), "fixture read");
    const denied = await client.callTool({ name: "host_read", arguments: { path: "ops/secret/.env" } }) as CallToolResult;
    assert(denied.isError, "secret path must be denied");
    console.log("host-only fixture MCP smoke ok: 5 tools, fixture read, secret denied");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
