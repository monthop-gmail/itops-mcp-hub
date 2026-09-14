import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "@itops/mcp-common";
import { z } from "zod";
import {
  assertModelAllowed,
  isModelAllowed,
  loadConfig,
  loadModelPolicy,
  pickServer,
  type ModelPolicy,
} from "./config.js";
import { fieldsNotApplied } from "./fields.js";
import {
  DEFAULT_LIMIT,
  FIXTURE_CONTEXT,
  FIXTURE_MODELS,
  FIXTURE_PARTNERS,
  FIXTURE_VERSION,
} from "./fixture.js";
import { execute, groupBy, version, type OdooConfig, type ServerConfig } from "./odoo.js";

export type OdooBackendKind = "fixture" | "jsonrpc";

export interface OdooRuntime {
  kind: OdooBackendKind;
  allowWrite: boolean;
  policy: ModelPolicy;
  config: () => OdooConfig;
}

const Domain = z
  .array(z.union([z.string(), z.array(z.any())]))
  .optional()
  .describe(
    "Search domain. Example: [['is_company', '=', true]]. Prefix operators '&', '|' and '!' may appear as strings.",
  );

const Model = z.string().describe("Odoo model name (e.g. 'res.partner', 'sale.order')");
const Ids = z.array(z.number().int()).describe("Record IDs");
const Server = z.string().optional().describe("Server name from config. Omitted, the default is used.");

function domainOf(raw: unknown[] | undefined): unknown[] {
  return raw ?? [];
}

async function readBack(
  key: string,
  server: ServerConfig,
  model: string,
  ids: number[],
  values: Record<string, unknown>,
): Promise<Record<string, unknown>[] | null> {
  const fields = Object.keys(values);
  if (fields.length === 0 || ids.length > DEFAULT_LIMIT) {
    return null;
  }
  return execute<Record<string, unknown>[]>(key, server, model, "read", [ids], { fields });
}

function writeDisabled() {
  return errorResult("Write tools are disabled. Set ODOO_ALLOW_WRITE=true on sub-mcp-odoo and mcp-hub-accounting.");
}

export function registerOdooTools(server: McpServer, runtime: OdooRuntime): void {
  const policy = () => runtime.policy;
  const target = (name?: string) => pickServer(runtime.config(), name);
  const targetFor = (model: string, name?: string) => {
    assertModelAllowed(policy(), model);
    return target(name);
  };

  const run = async (fn: () => Promise<unknown>) => {
    try {
      return jsonResult(await fn());
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  };

  server.tool(
    "odoo_get_status",
    "สถานะการต่อ Odoo: โหมด fixture / jsonrpc, เซิร์ฟเวอร์ที่ตั้ง, sample, allow_write",
    {},
    async () =>
      run(async () => {
        if (runtime.kind === "fixture") {
          return {
            ok: true,
            product: "Odoo",
            vendor: "https://www.odoo.com/",
            backend: "fixture",
            sample: true,
            allow_write: false,
            servers: ["fixture"],
            default_server: "fixture",
            blocked_models: policy().block,
            note: "ข้อมูลจำลอง — ICB/NST ตั้ง ACCOUNTING_PRODUCT=odoo และ ODOO_BACKEND=jsonrpc. MTR ไม่ใช้ Odoo",
          };
        }
        const cfg = runtime.config();
        return {
          ok: true,
          product: "Odoo",
          vendor: "https://www.odoo.com/",
          backend: "jsonrpc",
          sample: false,
          allow_write: runtime.allowWrite,
          servers: Object.keys(cfg.servers),
          default_server: cfg.defaultServer,
          blocked_models: policy().block,
          note: "คุย /jsonrpc (API key ชนิด rpc) อ่านอย่างเดียวจนกว่าจะเปิด ODOO_ALLOW_WRITE. ไม่ใช้ Cloudflare Worker — ฮับนี้มี OAuth อยู่แล้ว",
        };
      }),
  );

  server.tool(
    "odoo_list_servers",
    "รายชื่อ Odoo ที่ตั้งในคอนฟิกของไซต์นี้",
    {},
    async () =>
      run(async () => {
        if (runtime.kind === "fixture") {
          return { servers: ["fixture"], default_server: "fixture" };
        }
        const cfg = runtime.config();
        return { servers: Object.keys(cfg.servers), default_server: cfg.defaultServer };
      }),
  );

  server.tool(
    "odoo_search_read",
    "ค้นแล้วอ่านเรคอร์ดจากโมเดล Odoo. ค่าเริ่ม limit 50 — อย่าอ่านทั้งตารางโดยไม่ตั้งใจ",
    {
      server: Server,
      model: Model,
      domain: Domain,
      fields: z.array(z.string()).optional().describe("Field names. Omit for all fields."),
      offset: z.number().int().optional().describe("Records to skip"),
      limit: z.number().int().optional().describe(`Max records. Defaults to ${DEFAULT_LIMIT}`),
      order: z.string().optional().describe("Sort order (e.g. 'name asc, id desc')"),
    },
    async (args) =>
      run(async () => {
        if (runtime.kind === "fixture") {
          assertModelAllowed(policy(), args.model);
          if (args.model !== "res.partner") {
            return [];
          }
          return FIXTURE_PARTNERS.slice(args.offset ?? 0, (args.offset ?? 0) + (args.limit ?? DEFAULT_LIMIT));
        }
        const kwargs: Record<string, unknown> = { offset: args.offset ?? 0 };
        if (args.fields?.length) {
          kwargs.fields = args.fields;
        }
        kwargs.limit = args.limit ?? DEFAULT_LIMIT;
        if (args.order !== undefined) {
          kwargs.order = args.order;
        }
        const { name: key, server: cfg } = targetFor(args.model, args.server);
        return execute(key, cfg, args.model, "search_read", [domainOf(args.domain)], kwargs);
      }),
  );

  server.tool(
    "odoo_search_count",
    "นับเรคอร์ดที่ตรงโดเมนในโมเดล Odoo",
    { server: Server, model: Model, domain: Domain },
    async (args) =>
      run(async () => {
        if (runtime.kind === "fixture") {
          assertModelAllowed(policy(), args.model);
          return args.model === "res.partner" ? FIXTURE_PARTNERS.length : 0;
        }
        const { name: key, server: cfg } = targetFor(args.model, args.server);
        return execute(key, cfg, args.model, "search_count", [domainOf(args.domain)]);
      }),
  );

  server.tool(
    "odoo_read",
    "อ่านเรคอร์ดตาม id",
    {
      server: Server,
      model: Model,
      ids: Ids,
      fields: z.array(z.string()).optional(),
    },
    async (args) =>
      run(async () => {
        if (runtime.kind === "fixture") {
          assertModelAllowed(policy(), args.model);
          return FIXTURE_PARTNERS.filter((row) => args.ids.includes(row.id));
        }
        const kwargs: Record<string, unknown> = {};
        if (args.fields?.length) {
          kwargs.fields = args.fields;
        }
        const { name: key, server: cfg } = targetFor(args.model, args.server);
        return execute(key, cfg, args.model, "read", [args.ids], kwargs);
      }),
  );

  server.tool(
    "odoo_create",
    "สร้างเรคอร์ด แล้วอ่าน field ที่เขียนกลับมา พร้อม fields_not_applied ถ้า Odoo ทิ้งค่าเงียบ ๆ",
    {
      server: Server,
      model: Model,
      values: z.record(z.any()).describe("Field values for the new record"),
    },
    async (args) => {
      if (!runtime.allowWrite || runtime.kind === "fixture") {
        return writeDisabled();
      }
      return run(async () => {
        const { name: key, server: cfg } = targetFor(args.model, args.server);
        const id = await execute<number>(key, cfg, args.model, "create", [args.values]);
        const records = await readBack(key, cfg, args.model, [id], args.values);
        const record = records?.[0];
        if (!record) {
          return { id };
        }
        const dropped = fieldsNotApplied(args.values, record);
        return {
          id,
          record,
          ...(dropped.length > 0
            ? {
                fields_not_applied: dropped,
                warning:
                  "Odoo did not store these fields. They are usually readonly or computed; check odoo_fields_get before writing them again.",
              }
            : {}),
        };
      });
    },
  );

  server.tool(
    "odoo_write",
    "แก้เรคอร์ด แล้วอ่าน field ที่เขียนกลับมา พร้อม fields_not_applied ถ้า Odoo ทิ้งค่าเงียบ ๆ",
    {
      server: Server,
      model: Model,
      ids: Ids,
      values: z.record(z.any()),
    },
    async (args) => {
      if (!runtime.allowWrite || runtime.kind === "fixture") {
        return writeDisabled();
      }
      return run(async () => {
        const { name: key, server: cfg } = targetFor(args.model, args.server);
        const written = await execute<boolean>(key, cfg, args.model, "write", [args.ids, args.values]);
        const records = await readBack(key, cfg, args.model, args.ids, args.values);
        if (!records) {
          return { written };
        }
        const dropped = [...new Set(records.flatMap((record) => fieldsNotApplied(args.values, record)))];
        return {
          written,
          records,
          ...(dropped.length > 0
            ? {
                fields_not_applied: dropped,
                warning:
                  "Odoo did not store these fields on at least one record. They are usually readonly or computed; check odoo_fields_get.",
              }
            : {}),
        };
      });
    },
  );

  server.tool(
    "odoo_delete",
    "ลบเรคอร์ด (unlink) — ทำลายข้อมูล",
    { server: Server, model: Model, ids: Ids },
    async (args) => {
      if (!runtime.allowWrite || runtime.kind === "fixture") {
        return writeDisabled();
      }
      return run(async () => {
        const { name: key, server: cfg } = targetFor(args.model, args.server);
        return execute(key, cfg, args.model, "unlink", [args.ids]);
      });
    },
  );

  server.tool(
    "odoo_execute",
    "เรียก public method ใดก็ได้บนโมเดล — ใช้เมื่อเครื่องมืออื่นไม่ครอบคลุม. ถูกปิดเมื่อไม่อนุญาตเขียน",
    {
      server: Server,
      model: Model,
      method: z.string().describe("Method name"),
      args: z.array(z.any()).optional(),
      kwargs: z.record(z.any()).optional(),
    },
    async (args) => {
      if (!runtime.allowWrite || runtime.kind === "fixture") {
        return writeDisabled();
      }
      return run(async () => {
        const { name: key, server: cfg } = targetFor(args.model, args.server);
        return execute(key, cfg, args.model, args.method, args.args ?? [], args.kwargs ?? {});
      });
    },
  );

  server.tool(
    "odoo_fields_get",
    "นิยามฟิลด์ของโมเดล (string/type/required ฯลฯ)",
    {
      server: Server,
      model: Model,
      attributes: z.array(z.string()).optional(),
    },
    async (args) =>
      run(async () => {
        if (runtime.kind === "fixture") {
          assertModelAllowed(policy(), args.model);
          return {
            name: { string: "Name", type: "char", required: true },
            email: { string: "Email", type: "char", required: false },
            city: { string: "City", type: "char", required: false },
            is_company: { string: "Is a Company", type: "boolean", required: false },
          };
        }
        const kwargs: Record<string, unknown> = {};
        if (args.attributes?.length) {
          kwargs.attributes = args.attributes;
        }
        const { name: key, server: cfg } = targetFor(args.model, args.server);
        return execute(key, cfg, args.model, "fields_get", [], kwargs);
      }),
  );

  server.tool(
    "odoo_read_group",
    "จัดกลุ่มแล้วรวมยอด. ถ้า limit ตัดผล จะมี has_more + total_records — ห้ามบวกแถวที่เห็นแล้วยึดเป็นยอดจริง",
    {
      server: Server,
      model: Model,
      domain: Domain,
      groupby: z.array(z.string()).describe("Fields to group by, e.g. 'date_order:month'"),
      aggregates: z.array(z.string()).optional().describe("__count or field:agg such as amount_total:sum"),
      limit: z.number().int().optional(),
      offset: z.number().int().optional(),
      order: z.string().optional(),
    },
    async (args) =>
      run(async () => {
        const aggregates = args.aggregates?.length ? args.aggregates : ["__count"];
        if (runtime.kind === "fixture") {
          assertModelAllowed(policy(), args.model);
          const groups = [{ city: "ขอนแก่น", __count: 1 }, { city: "นครราชสีมา", __count: 1 }];
          if (args.limit !== undefined && groups.length > args.limit) {
            return {
              groups: groups.slice(0, args.limit),
              has_more: true,
              total_records: FIXTURE_PARTNERS.length,
              warning: `Showing ${args.limit} of more groups. Summing the rows above does not give the total.`,
            };
          }
          return { groups };
        }
        const { name: key, server: cfg } = targetFor(args.model, args.server);
        const kwargs: Record<string, unknown> = { offset: args.offset ?? 0 };
        if (args.order !== undefined) {
          kwargs.order = args.order;
        }
        if (args.limit !== undefined) {
          kwargs.limit = args.limit + 1;
        }
        const rows = (await groupBy(
          key,
          cfg,
          args.model,
          domainOf(args.domain),
          args.groupby,
          aggregates,
          kwargs,
        )) as Record<string, unknown>[];
        if (args.limit === undefined || rows.length <= args.limit) {
          return { groups: rows };
        }
        const total = await execute<number>(key, cfg, args.model, "search_count", [domainOf(args.domain)]);
        return {
          groups: rows.slice(0, args.limit),
          has_more: true,
          total_records: total,
          warning:
            `Showing ${args.limit} of more groups. Summing the rows above does not give ` +
            `the total — ${total} records match this domain. Raise 'limit' to see the rest.`,
        };
      }),
  );

  server.tool(
    "odoo_context",
    "ผู้ใช้ บริษัท timezone ภาษาของ connection นี้. อ่านก่อนทำงานกับวันที่ — Odoo เก็บ datetime เป็น UTC",
    { server: Server },
    async (args) =>
      run(async () => {
        if (runtime.kind === "fixture") {
          return FIXTURE_CONTEXT;
        }
        const { name: key, server: cfg } = target(args.server);
        const context = await execute<{ uid: number; tz?: string; lang?: string }>(
          key,
          cfg,
          "res.users",
          "context_get",
          [],
        );
        const [user] = await execute<Record<string, unknown>[]>(key, cfg, "res.users", "read", [[context.uid]], {
          fields: ["name", "login", "company_id", "company_ids"],
        });
        return {
          server: key,
          uid: context.uid,
          user: user?.name ?? null,
          login: user?.login ?? null,
          company: user?.company_id ?? null,
          companies: user?.company_ids ?? [],
          timezone: context.tz ?? null,
          language: context.lang ?? null,
          note: "Datetimes stored in Odoo are UTC. Convert to the timezone above only when presenting them to a person, and send UTC back.",
        };
      }),
  );

  server.tool(
    "odoo_get_models",
    "รายชื่อโมเดลที่ใช้ได้ (ตัด wizard และโมเดลที่ BLOCKED_MODELS กัน). บัญชีต่ำอาจเรียก ir.model ไม่ได้",
    {
      server: Server,
      filter: z.string().optional(),
      limit: z.number().int().optional(),
    },
    async (args) =>
      run(async () => {
        const limit = args.limit ?? 200;
        const needle = args.filter?.trim().toLowerCase();
        if (runtime.kind === "fixture") {
          const models = FIXTURE_MODELS.filter((entry) => isModelAllowed(policy(), entry.model)).filter((entry) =>
            needle ? entry.model.includes(needle) || entry.name.toLowerCase().includes(needle) : true,
          );
          return { count: models.length, hidden_by_policy: FIXTURE_MODELS.length - models.length, models };
        }
        const { name: key, server: cfg } = target(args.server);
        const domain: unknown[] = [
          ["transient", "=", false],
          ["abstract", "=", false],
        ];
        if (args.filter) {
          domain.unshift("|", ["model", "ilike", args.filter], ["name", "ilike", args.filter]);
        }
        const models = await execute<{ model: string; name: string }[]>(key, cfg, "ir.model", "search_read", [domain], {
          fields: ["model", "name"],
          order: "model",
          limit,
        });
        const inScope = models.filter((entry) => isModelAllowed(policy(), entry.model));
        return {
          count: inScope.length,
          hidden_by_policy: models.length - inScope.length,
          models: inScope.map((entry) => ({ model: entry.model, name: entry.name })),
        };
      }),
  );

  server.tool(
    "odoo_version",
    "เวอร์ชันเซิร์ฟเวอร์ Odoo (ไม่ต้องล็อกอิน)",
    { server: Server },
    async (args) =>
      run(async () => {
        if (runtime.kind === "fixture") {
          return FIXTURE_VERSION;
        }
        return version(target(args.server).server);
      }),
  );
}

export function createOdooRuntime(): OdooRuntime {
  const kind: OdooBackendKind =
    (process.env.ODOO_BACKEND ?? "fixture").trim().toLowerCase() === "jsonrpc" ? "jsonrpc" : "fixture";
  const allowWrite = (process.env.ODOO_ALLOW_WRITE ?? "").trim().toLowerCase() === "true";
  const policy = loadModelPolicy(process.env);
  let cached: OdooConfig | undefined;
  return {
    kind,
    allowWrite: kind === "jsonrpc" && allowWrite,
    policy,
    config: () => {
      if (kind === "fixture") {
        throw new Error("fixture backend has no live Odoo config");
      }
      return (cached ??= loadConfig(process.env));
    },
  };
}
