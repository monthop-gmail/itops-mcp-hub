import { FIXTURE_TOOLS, fixtureCall, isToolAllowed } from "./policy.js";
import type { PstackCallResult, PstackStatus, PstackStore, PstackToolInfo } from "./types.js";
import { PstackError } from "./types.js";

export class FixtureStore implements PstackStore {
  readonly kind = "fixture" as const;

  constructor(
    private readonly allow: string[],
    private readonly block: string[],
  ) {}

  async status(): Promise<PstackStatus> {
    const tools = await this.listTools();
    return {
      ok: true,
      product: "pstack",
      vendor: "https://github.com/willpower-institute/pstack",
      backend: "fixture",
      sample: true,
      app: "pstack-fixture",
      modules: ["users", "faq", "api_keys", "mcp_server", "tenancy"],
      server_name: "pstack",
      server_version: "fixture",
      tool_count: tools.length,
      note: "ข้อมูลจำลอง — ไม่ได้ฝัง pstack ในสแตกนี้. ต่ออินสแตนซ์จริงด้วย PSTACK_BACKEND=http + PSTACK_URL + PSTACK_API_KEY (psk_). ไม่เรียกเอเจนต์ Claude ในตัว pstack",
    };
  }

  async listTools(query?: string): Promise<PstackToolInfo[]> {
    const needle = query?.trim().toLowerCase();
    return FIXTURE_TOOLS.filter((tool) => isToolAllowed(tool.name, this.allow, this.block)).filter((tool) =>
      needle ? tool.name.toLowerCase().includes(needle) || tool.description.toLowerCase().includes(needle) : true,
    );
  }

  async callTool(name: string, args: Record<string, unknown>, tenantId?: string): Promise<PstackCallResult> {
    if (!isToolAllowed(name, this.allow, this.block)) {
      throw new PstackError(`Tool '${name}' is out of scope (PSTACK_ALLOWED_TOOLS / PSTACK_BLOCKED_TOOLS)`);
    }
    try {
      const text = fixtureCall(name, args);
      return { ok: true, tool: name, tenant_id: tenantId, is_error: false, text };
    } catch (error) {
      throw new PstackError(error instanceof Error ? error.message : String(error));
    }
  }
}
