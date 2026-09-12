import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { errorResult, log } from "@itops/mcp-common";

export class BackendMcpClient {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;

  constructor(
    private readonly name: string,
    private readonly baseUrl: string,
  ) {}

  async callTool(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
    try {
      const client = await this.getClient();
      const result = await client.callTool({ name: toolName, arguments: args });
      return result as CallToolResult;
    } catch (error) {
      log("warn", "backend tool call failed; resetting session", {
        backend: this.name,
        toolName,
        err: error instanceof Error ? error.message : String(error),
      });
      await this.reset();
      try {
        const client = await this.getClient();
        const result = await client.callTool({ name: toolName, arguments: args });
        return result as CallToolResult;
      } catch (retryError) {
        return errorResult(
          `${this.name} '${toolName}' failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
        );
      }
    }
  }

  private async getClient(): Promise<Client> {
    if (this.client) {
      return this.client;
    }
    if (this.connecting) {
      return this.connecting;
    }
    this.connecting = this.connect();
    try {
      this.client = await this.connecting;
      return this.client;
    } finally {
      this.connecting = null;
    }
  }

  private async connect(): Promise<Client> {
    const mcpUrl = new URL("/mcp", this.baseUrl);
    const sseUrl = new URL("/sse", this.baseUrl);

    try {
      const transport = new StreamableHTTPClientTransport(mcpUrl);
      const client = new Client({ name: `mcp-hub→${this.name}`, version: "1.0.0" });
      await client.connect(transport);
      log("info", "connected to backend via streamable HTTP", {
        backend: this.name,
        url: mcpUrl.toString(),
      });
      return client;
    } catch (error) {
      log("warn", "streamable HTTP connect failed; trying SSE", {
        backend: this.name,
        err: error instanceof Error ? error.message : String(error),
      });
    }

    const transport = new SSEClientTransport(sseUrl);
    const client = new Client({ name: `mcp-hub→${this.name}`, version: "1.0.0" });
    await client.connect(transport);
    log("info", "connected to backend via SSE", {
      backend: this.name,
      url: sseUrl.toString(),
    });
    return client;
  }

  private async reset(): Promise<void> {
    const current = this.client;
    this.client = null;
    if (current) {
      try {
        await current.close();
      } catch {
        // ignore close errors
      }
    }
  }
}
