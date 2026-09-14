import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  companyFromConfig,
  glFromGlmst,
  indexNames,
  invoiceFromArtr,
  itemFromInvmst,
  partyFromMaster,
} from "./map.js";
import type { AllinoneBooks, AllinoneRow, AllinoneStore } from "./types.js";

const SKIP_MDB = new Set(["config.mdb"]);

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      err += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${cmd} ${args.join(" ")} failed (${code}): ${err.trim() || out.trim()}`));
        return;
      }
      resolve(out);
    });
  });
}

export function resolveMdbFile(dataDir: string, named = ""): string {
  if (named) {
    return named.startsWith("/") ? named : join(dataDir, named);
  }
  const names = readdirSync(dataDir);
  const mdbs = names.filter((name) => name.toLowerCase().endsWith(".mdb") && !SKIP_MDB.has(name.toLowerCase()));
  if (mdbs.length === 0) {
    throw new Error(`No Allinone .mdb in ${dataDir} (expected ARMST in a company .mdb, not CONFIG.MDB)`);
  }
  const preferred = mdbs.find((name) => name.toLowerCase() === "demo.mdb") ?? mdbs[0];
  return join(dataDir, preferred);
}

async function listTables(mdbPath: string): Promise<string[]> {
  const out = await run("mdb-tables", ["-1", mdbPath]);
  return out
    .split(/\s+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

async function exportTable(mdbPath: string, table: string): Promise<AllinoneRow[]> {
  const out = await run("mdb-json", ["-T", "%Y-%m-%d", mdbPath, table]);
  const rows: AllinoneRow[] = [];
  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    rows.push(JSON.parse(trimmed) as AllinoneRow);
  }
  return rows;
}

async function tableColumns(mdbPath: string, table: string): Promise<string[]> {
  const out = await run("mdb-schema", ["-T", table, mdbPath]);
  const cols: string[] = [];
  for (const line of out.split("\n")) {
    const match = line.match(/\[([^\]]+)\]\s+\t/);
    if (match && match[1] !== table) {
      cols.push(match[1]);
    }
  }
  return cols;
}

async function exportIfPresent(mdbPath: string, tables: string[], name: string): Promise<AllinoneRow[]> {
  const found = tables.find((table) => table.toLowerCase() === name.toLowerCase());
  if (!found) {
    return [];
  }
  return exportTable(mdbPath, found);
}

export class MdbStore implements AllinoneStore {
  readonly kind = "mdb" as const;

  constructor(
    private readonly dataDir: string,
    private readonly mdbFile: string,
    private readonly companyName: string,
  ) {}

  async inspect(): Promise<{ tables: string[]; columns: Record<string, string[]> }> {
    const mdbPath = resolveMdbFile(this.dataDir, this.mdbFile);
    const tables = await listTables(mdbPath);
    const columns: Record<string, string[]> = {};
    for (const wanted of ["ARMST", "APMST", "INVMST", "ARTR", "GLMST", "CONFIG"]) {
      const found = tables.find((table) => table.toLowerCase() === wanted.toLowerCase());
      columns[wanted] = found ? await tableColumns(mdbPath, found) : [];
    }
    return { tables, columns };
  }

  async load(): Promise<AllinoneBooks> {
    const mdbPath = resolveMdbFile(this.dataDir, this.mdbFile);
    const tables = await listTables(mdbPath);
    const [armst, apmst, invmst, artr, glmst, config] = await Promise.all([
      exportIfPresent(mdbPath, tables, "ARMST"),
      exportIfPresent(mdbPath, tables, "APMST"),
      exportIfPresent(mdbPath, tables, "INVMST"),
      exportIfPresent(mdbPath, tables, "ARTR"),
      exportIfPresent(mdbPath, tables, "GLMST"),
      exportIfPresent(mdbPath, tables, "CONFIG"),
    ]);
    if (armst.length === 0 && apmst.length === 0 && invmst.length === 0) {
      throw new Error(`Allinone MDB ${mdbPath} has no ARMST/APMST/INVMST`);
    }
    const customers = armst.map((row) => partyFromMaster(row)).filter((row) => row.code);
    const names = indexNames(customers);
    const company = this.companyName || companyFromConfig(config) || "Allinone VM";
    const invoices = artr
      .map((row) => invoiceFromArtr(row, names))
      .filter((row): row is NonNullable<typeof row> => row != null);
    const missing: string[] = [];
    for (const name of ["ARMST", "APMST", "INVMST", "ARTR", "GLMST", "CONFIG"]) {
      if (!tables.some((table) => table.toLowerCase() === name.toLowerCase())) {
        missing.push(name);
      }
    }
    return {
      status: {
        ok: true,
        product: "Allinone",
        vendor: "https://www.allinonesoft.com/",
        edition: "vm",
        backend: "mdb",
        company_name: company,
        sample: false,
        source: mdbPath,
        tables,
        note: missing.length
          ? `อ่าน Access แล้ว ตารางที่ไม่มี: ${missing.join(", ")}`
          : `อ่าน Access จาก ${mdbPath.split("/").pop()} (ARMST/APMST/INVMST/ARTR/GLMST)`,
      },
      customers,
      vendors: apmst.map((row) => partyFromMaster(row)).filter((row) => row.code),
      items: invmst.map((row) => itemFromInvmst(row)).filter((row) => row.code),
      arInvoices: invoices,
      glAccounts: glmst.map((row) => glFromGlmst(row)).filter((row) => row.code),
    };
  }
}
