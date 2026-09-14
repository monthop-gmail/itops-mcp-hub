import { optionalEnv } from "@itops/mcp-common";
import { FixtureStore } from "./fixture.js";
import { HttpStore } from "./http-store.js";
import { parseList, stripUrl } from "./policy.js";
import type { PstackStore } from "./types.js";

export function createPstackStore(): PstackStore {
  const allow = parseList(optionalEnv("PSTACK_ALLOWED_TOOLS"));
  const block = parseList(optionalEnv("PSTACK_BLOCKED_TOOLS"));
  const backend = optionalEnv("PSTACK_BACKEND", "fixture").toLowerCase();
  if (backend === "http") {
    const baseUrl = stripUrl(optionalEnv("PSTACK_URL"));
    const apiKey = optionalEnv("PSTACK_API_KEY");
    if (!baseUrl || !apiKey) {
      throw new Error("PSTACK_BACKEND=http requires PSTACK_URL and PSTACK_API_KEY");
    }
    return new HttpStore(
      {
        baseUrl,
        apiKey,
        tenantId: optionalEnv("PSTACK_TENANT_ID"),
      },
      allow,
      block,
    );
  }
  return new FixtureStore(allow, block);
}
