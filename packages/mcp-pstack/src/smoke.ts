import { FixtureStore } from "./fixture.js";
import { HttpStore } from "./http-store.js";
import { isToolAllowed, mcpUrl, parseList, stripUrl } from "./policy.js";
import { pstackRpc } from "./rpc.js";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  assert(stripUrl("http://pstack.example.com///") === "http://pstack.example.com", "strip url");
  assert(mcpUrl("http://host:8000/") === "http://host:8000/mcp", "mcp url");

  assert(isToolAllowed("search_faq", [], []), "open policy");
  assert(!isToolAllowed("count_users", ["search_faq"], []), "allow miss");
  assert(isToolAllowed("search_faq", ["search_*"], []), "allow prefix");
  assert(!isToolAllowed("search_users", [], ["search_users"]), "block exact");
  assert(!isToolAllowed("search_users", ["search_*"], ["search_users"]), "block wins");
  assert(parseList(" a , b ").join(",") === "a,b", "parse list");

  const fixture = new FixtureStore([], []);
  const status = await fixture.status();
  assert(status.sample && status.backend === "fixture" && (status.tool_count ?? 0) >= 2, "fixture status");
  const tools = await fixture.listTools("faq");
  assert(tools.length === 1 && tools[0].name === "search_faq", "fixture list filter");
  const faq = await fixture.callTool("search_faq", { query: "pstack" });
  assert(!faq.is_error && faq.text.includes("POST /mcp"), "fixture faq");
  const users = await fixture.callTool("count_users", {});
  assert(users.text.includes("2 คน"), "fixture count");
  let blocked = false;
  try {
    await new FixtureStore(["search_faq"], []).callTool("count_users", {});
  } catch {
    blocked = true;
  }
  assert(blocked, "fixture allowlist");

  const calls: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ url, body, headers });
    if (url.endsWith("/healthz")) {
      return new Response(JSON.stringify({ status: "ok", app: "pstack", modules: ["users", "mcp_server"] }), {
        status: 200,
      });
    }
    const method = body.method;
    if (method === "initialize") {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { serverInfo: { name: "pstack", version: "0.5.2" } } }),
        { status: 200 },
      );
    }
    if (method === "tools/list") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [
              { name: "search_faq", description: "FAQ", inputSchema: { type: "object" } },
              { name: "count_users", description: "users" },
            ],
          },
        }),
        { status: 200 },
      );
    }
    if (method === "tools/call") {
      const params = body.params as { name: string };
      if (params.name === "nope") {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "unknown or unauthorized tool: nope" } }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: "มีผู้ใช้ active 3 คน" }], isError: false },
        }),
        { status: 200 },
      );
    }
    return new Response("nope", { status: 500 });
  }) as typeof fetch;

  try {
    const live = new HttpStore(
      { baseUrl: "https://pstack.test/", apiKey: "psk_test", tenantId: "icb" },
      [],
      [],
    );
    const liveStatus = await live.status();
    assert(liveStatus.sample === false && liveStatus.server_name === "pstack" && liveStatus.app === "pstack", "live status");
    assert((liveStatus.tool_count ?? 0) === 2, "live tool count");
    const called = await live.callTool("count_users", {}, "clinic-a");
    assert(called.text.includes("3 คน") && called.ok, "live call");
    const tenantHeader = calls.find((row) => row.body.method === "tools/call")?.headers.get("x-tenant-id");
    assert(tenantHeader === "clinic-a", `tenant header: ${tenantHeader}`);
    const auth = calls.find((row) => row.url.endsWith("/mcp"))?.headers.get("authorization");
    assert(auth === "Bearer psk_test", "bearer");

    let rpcErr = false;
    try {
      await pstackRpc({ baseUrl: "https://pstack.test", apiKey: "psk_test", tenantId: "" }, "tools/call", {
        name: "nope",
        arguments: {},
      });
    } catch (error) {
      rpcErr = error instanceof Error && /unknown or unauthorized tool: nope/.test(error.message);
    }
    assert(rpcErr, "jsonrpc error");
  } finally {
    globalThis.fetch = previous;
  }

  globalThis.fetch = (async () => new Response("", { status: 401 })) as typeof fetch;
  try {
    await pstackRpc({ baseUrl: "https://pstack.test", apiKey: "bad", tenantId: "" }, "ping");
    throw new Error("expected 401");
  } catch (error) {
    assert(error instanceof Error && /HTTP 401/.test(error.message), "401");
  }
  globalThis.fetch = previous;

  console.log("pstack fixture/policy/jsonrpc smoke ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
