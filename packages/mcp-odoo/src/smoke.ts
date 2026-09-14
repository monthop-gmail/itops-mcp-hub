import { ConfigError, isModelAllowed, loadConfig, loadModelPolicy } from "./config.js";
import { fieldsNotApplied } from "./fields.js";
import { OdooError, clearUidCache, execute, version, type ServerConfig } from "./odoo.js";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) {
    throw new Error(message);
  }
}

const env = (vars: Record<string, string>) => vars;

const one = {
  ODOO_URL: "https://odoo.example.com",
  ODOO_DB: "mydb",
  ODOO_USERNAME: "bot@example.com",
  ODOO_PASSWORD: "key",
};

const server = (): ServerConfig => ({
  url: "https://odoo.test",
  db: "db",
  username: "bot",
  password: "pw",
});

const ok = (result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
const fail = (message: string, name = "odoo.exceptions.AccessError") =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { data: { name, message } } }), { status: 200 });

const callOf = (init: RequestInit | undefined) => {
  const { params } = JSON.parse(String(init?.body));
  return `${params.service}.${params.method}`;
};

async function withFetch<T>(
  handler: (call: string, n: number) => Response | Promise<Response>,
  fn: () => Promise<T>,
): Promise<{ result: T; calls: string[] }> {
  const calls: string[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const call = callOf(init);
    calls.push(call);
    return handler(call, calls.filter((c) => c === call).length);
  }) as typeof fetch;
  try {
    return { result: await fn(), calls };
  } finally {
    globalThis.fetch = previous;
  }
}

async function main(): Promise<void> {
  clearUidCache();

  const openPolicy = loadModelPolicy(env({}));
  assert(isModelAllowed(openPolicy, "res.partner") && isModelAllowed(openPolicy, "ir.cron"), "empty policy should allow all");

  const exact = loadModelPolicy(env({ BLOCKED_MODELS: "res.users" }));
  assert(!isModelAllowed(exact, "res.users"), "exact block missed res.users");
  assert(isModelAllowed(exact, "res.users.apikeys"), "exact res.users must not catch apikeys — that was a real bug");

  const star = loadModelPolicy(env({ BLOCKED_MODELS: "res.users*" }));
  assert(!isModelAllowed(star, "res.users") && !isModelAllowed(star, "res.users.apikeys"), "prefix * failed");
  assert(isModelAllowed(star, "res.partner"), "prefix * over-blocked partner");

  const recommended = loadModelPolicy(env({ BLOCKED_MODELS: "ir.*,res.users*,res.groups*" }));
  for (const model of [
    "ir.cron",
    "ir.actions.server",
    "ir.config_parameter",
    "ir.model.access",
    "res.users",
    "res.users.apikeys",
    "res.groups",
  ]) {
    assert(!isModelAllowed(recommended, model), `recommended block missed ${model}`);
  }
  assert(isModelAllowed(recommended, "res.partner"), "recommended block hit partner");
  assert(isModelAllowed(loadModelPolicy(env({ BLOCKED_MODELS: "ir.*" })), "theme.ir.ui.view"), "ir.* must not match mid-name");

  const spaced = loadModelPolicy(env({ BLOCKED_MODELS: " ir.* , res.users* " }));
  assert(!isModelAllowed(spaced, "ir.cron") && !isModelAllowed(spaced, "res.users"), "comma trim failed");
  assert(isModelAllowed(loadModelPolicy(env({ BLOCKED_MODELS: "  ,, " })), "ir.cron"), "blank block should allow");

  const allow = loadModelPolicy(env({ ALLOWED_MODELS: "res.partner,sale.*" }));
  assert(isModelAllowed(allow, "res.partner") && isModelAllowed(allow, "sale.order") && !isModelAllowed(allow, "res.users"), "ALLOWED_MODELS failed");
  const both = loadModelPolicy(env({ ALLOWED_MODELS: "res.*", BLOCKED_MODELS: "res.users*" }));
  assert(isModelAllowed(both, "res.partner") && !isModelAllowed(both, "res.users"), "BLOCKED should win ALLOWED");

  assert(
    JSON.stringify(fieldsNotApplied({ name: "A", is_company: true }, { name: "A", is_company: false })) ===
      JSON.stringify(["is_company"]),
    "readonly drop not detected",
  );
  assert(fieldsNotApplied({ complete_name: "x" }, { complete_name: "ทดสอบ" })[0] === "complete_name", "computed overwrite");
  assert(fieldsNotApplied({ name: "A", city: "ภูเก็ต" }, { name: "A", city: "ภูเก็ต" }).length === 0, "matching values");
  assert(fieldsNotApplied({ comment: "ok" }, { comment: "<p>ok</p>" }).length === 0, "html false positive");
  assert(fieldsNotApplied({ comment: "a & b" }, { comment: "<p>a &amp;&nbsp;b</p>" }).length === 0, "html entity false positive");
  assert(fieldsNotApplied({ country_id: 217 }, { country_id: [217, "Thailand"] }).length === 0, "many2one id");
  assert(fieldsNotApplied({ comment: "" }, { comment: false }).length === 0, "empty string as false");
  assert(fieldsNotApplied({ name: "A", city: "x" }, { name: "A" }).length === 0, "unread field");
  assert(fieldsNotApplied({ child_ids: [[6, 0, [1, 2]]] }, { child_ids: [1, 2] }).length === 0, "x2many silence");
  assert(fieldsNotApplied({ meta: { a: 1 } }, { meta: false }).length === 0, "nested silence");
  assert(fieldsNotApplied({ country_id: 217 }, { country_id: [1, "Andorra"] })[0] === "country_id", "many2one drop");

  const single = loadConfig(env(one));
  assert(single.defaultServer === "default" && single.servers.default.url === "https://odoo.example.com", "single-server config");
  assert(loadConfig(env({ ...one, ODOO_URL: "https://x.com///" })).servers.default.url === "https://x.com", "trailing slash");
  let missing = false;
  try {
    const { ODOO_PASSWORD: _drop, ...partial } = one;
    loadConfig(env(partial));
  } catch (error) {
    missing = error instanceof ConfigError && /ODOO_PASSWORD/.test(error.message);
  }
  assert(missing, "partial single-server should fail");

  const multi = JSON.stringify({
    default_server: "ee",
    servers: {
      ce: { url: "http://odoo:8069", db: "test19", username: "mcp-bot", password: "x" },
      ee: { url: "https://a.odoo.com", db: "a", username: "bot@a.com", password: "y" },
    },
  });
  const parsed = loadConfig(env({ ODOO_SERVERS: multi }));
  assert(parsed.defaultServer === "ee" && Object.keys(parsed.servers).sort().join(",") === "ce,ee", "multi server");
  assert(Object.keys(loadConfig(env({ ...one, ODOO_SERVERS: multi })).servers).sort().join(",") === "ce,ee", "ODOO_SERVERS wins");
  const firstOnly = JSON.stringify({ servers: { ce: JSON.parse(multi).servers.ce } });
  assert(loadConfig(env({ ODOO_SERVERS: firstOnly })).defaultServer === "ce", "first server default");

  try {
    loadConfig(env({ ODOO_SERVERS: "{not json" }));
    throw new Error("expected JSON error");
  } catch (error) {
    assert(error instanceof ConfigError && /not valid JSON/.test(error.message), "bad JSON");
  }
  try {
    loadConfig(env({ ODOO_SERVERS: '{"servers":{}}' }));
    throw new Error("expected empty servers");
  } catch (error) {
    assert(error instanceof ConfigError && /contains no servers/.test(error.message), "empty servers");
  }
  try {
    loadConfig(env({ ODOO_SERVERS: '{"servers":{"ce":{"url":"http://x","db":"d","username":"u"}}}' }));
    throw new Error("expected missing password");
  } catch (error) {
    assert(error instanceof ConfigError && /server 'ce' is missing 'password'/.test(error.message), "missing field");
  }
  try {
    loadConfig(env({ ODOO_SERVERS: JSON.stringify({ default_server: "nope", servers: JSON.parse(multi).servers }) }));
    throw new Error("expected bad default");
  } catch (error) {
    assert(error instanceof ConfigError && /ce, ee/.test(error.message), "unknown default_server");
  }

  const cacheHit = await withFetch(
    (call) => (call === "common.authenticate" ? ok(7) : ok("done")),
    async () => {
      await execute("cache-hit", server(), "res.partner", "search_count", [[]]);
      await execute("cache-hit", server(), "res.partner", "search_count", [[]]);
    },
  );
  assert(cacheHit.calls.filter((c) => c === "common.authenticate").length === 1, "uid should be cached");

  const stale = await withFetch(
    (call, n) => {
      if (call === "common.authenticate") {
        return ok(n === 1 ? 7 : 9);
      }
      return n === 1 ? fail("Session expired") : ok("done");
    },
    async () => execute("stale-uid", server(), "res.partner", "read", [[1]]),
  );
  assert(stale.result === "done", "stale uid retry failed");

  let alwaysFails = false;
  try {
    await withFetch(
      (call) => (call === "common.authenticate" ? ok(7) : fail("Invalid field 'nope'", "builtins.ValueError")),
      async () => execute("always-fails", server(), "res.partner", "read", [[1]]),
    );
  } catch (error) {
    alwaysFails = error instanceof OdooError && /builtins.ValueError: Invalid field 'nope'/.test(error.message);
  }
  assert(alwaysFails, "persistent Odoo error should surface");

  try {
    await withFetch(() => ok(false), async () => execute("bad-login", server(), "res.partner", "read", [[1]]));
    throw new Error("expected auth failure");
  } catch (error) {
    assert(
      error instanceof OdooError && /Authentication failed for user 'bot' on database 'db'/.test(error.message),
      "auth failure message",
    );
  }

  try {
    await withFetch(() => fail("Object res.nope doesn't exist", "odoo.exceptions.UserError"), async () =>
      version(server()),
    );
    throw new Error("expected nested error");
  } catch (error) {
    assert(
      error instanceof OdooError && error.message === "odoo.exceptions.UserError: Object res.nope doesn't exist",
      `nested error: ${error instanceof Error ? error.message : error}`,
    );
  }

  const previous = globalThis.fetch;
  globalThis.fetch = (async () => new Response("<html>", { status: 200 })) as typeof fetch;
  try {
    await version(server());
    throw new Error("expected non-JSON");
  } catch (error) {
    assert(error instanceof OdooError && /non-JSON response/.test(error.message), "non-JSON");
  }
  globalThis.fetch = (async () => new Response("", { status: 502 })) as typeof fetch;
  try {
    await version(server());
    throw new Error("expected 502");
  } catch (error) {
    assert(error instanceof OdooError && /HTTP 502/.test(error.message), "HTTP 502");
  }
  globalThis.fetch = (async () => {
    throw new TypeError("connect ECONNREFUSED");
  }) as typeof fetch;
  try {
    await version(server());
    throw new Error("expected connect error");
  } catch (error) {
    assert(error instanceof OdooError && /Cannot reach Odoo at https:\/\/odoo.test/.test(error.message), "connect error");
  }
  globalThis.fetch = previous;

  process.env.ODOO_BACKEND = "fixture";
  process.env.ODOO_ALLOW_WRITE = "false";
  process.env.ODOO_BLOCKED_MODELS = "ir.*,res.users*,res.groups*";
  const { createOdooRuntime } = await import("./tools.js");
  const runtime = createOdooRuntime();
  assert(runtime.kind === "fixture" && runtime.allowWrite === false, "fixture runtime");
  assert(!isModelAllowed(runtime.policy, "res.users.apikeys"), "runtime policy");

  console.log("odoo fixture/policy/jsonrpc-client smoke ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
