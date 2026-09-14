import { isToolAllowed } from "./policy.js";
import {
  asToolInfo,
  pstackHealth,
  pstackRpc,
  type InitializeResult,
  type PstackRpcConfig,
  type ToolsCallResult,
  type ToolsListResult,
} from "./rpc.js";
import { PstackError, type PstackCallResult, type PstackStatus, type PstackStore, type PstackToolInfo } from "./types.js";

export class HttpStore implements PstackStore {
  readonly kind = "http" as const;

  constructor(
    private readonly config: PstackRpcConfig,
    private readonly allow: string[],
    private readonly block: string[],
  ) {}

  async status(): Promise<PstackStatus> {
    const [health, init, tools] = await Promise.all([
      pstackHealth(this.config.baseUrl),
      pstackRpc<InitializeResult>(this.config, "initialize", { protocolVersion: "2025-06-18" }),
      this.listTools(),
    ]);
    return {
      ok: health.status === "ok" || health.status === undefined,
      product: "pstack",
      vendor: "https://github.com/willpower-institute/pstack",
      backend: "http",
      sample: false,
      url: this.config.baseUrl,
      app: health.app,
      modules: health.modules,
      server_name: init.serverInfo?.name,
      server_version: init.serverInfo?.version,
      tenant_id: this.config.tenantId || undefined,
      tool_count: tools.length,
      note: "ต่อ POST /mcp ของ pstack ด้วย API key — สิทธิ์ตามเจ้าของ key บน pstack ไม่ใช่เอเจนต์ในตัว. โมดูลใหม่ของ pstack โผล่ใน pstack_list_tools โดยไม่ต้องแก้ฮับ",
    };
  }

  async listTools(query?: string): Promise<PstackToolInfo[]> {
    const listed = await pstackRpc<ToolsListResult>(this.config, "tools/list");
    const needle = query?.trim().toLowerCase();
    return (listed.tools ?? [])
      .map(asToolInfo)
      .filter((tool) => isToolAllowed(tool.name, this.allow, this.block))
      .filter((tool) =>
        needle ? tool.name.toLowerCase().includes(needle) || tool.description.toLowerCase().includes(needle) : true,
      );
  }

  async callTool(name: string, args: Record<string, unknown>, tenantId?: string): Promise<PstackCallResult> {
    if (!isToolAllowed(name, this.allow, this.block)) {
      throw new PstackError(`Tool '${name}' is out of scope (PSTACK_ALLOWED_TOOLS / PSTACK_BLOCKED_TOOLS)`);
    }
    const result = await pstackRpc<ToolsCallResult>(
      this.config,
      "tools/call",
      { name, arguments: args },
      tenantId,
    );
    const text = (result.content ?? []).map((part) => part.text ?? "").join("\n").trim();
    return {
      ok: !result.isError,
      tool: name,
      tenant_id: tenantId || this.config.tenantId || undefined,
      is_error: Boolean(result.isError),
      text,
    };
  }
}
