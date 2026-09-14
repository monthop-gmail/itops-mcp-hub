import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  departmentFromRow,
  deviceFromRow,
  employeeFromUserinfo,
  indexDepartments,
  indexPeople,
  punchFromRow,
  dateInRange,
  matchesQuery,
} from "./map.js";
import type {
  ZktimeDepartment,
  ZktimeDevice,
  ZktimeEmployee,
  ZktimePunch,
  ZktimePunchQuery,
  ZktimeRow,
  ZktimeStatus,
  ZktimeStore,
} from "./types.js";

const MAPPED = ["USERINFO", "CHECKINOUT", "DEPARTMENTS", "Machines"] as const;

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
  const mdbs = names.filter((name) => name.toLowerCase().endsWith(".mdb"));
  if (mdbs.length === 0) {
    throw new Error(`No ZKTime .mdb in ${dataDir} (expected att2000.mdb)`);
  }
  const preferred =
    mdbs.find((name) => name.toLowerCase() === "att2000.mdb") ??
    mdbs.find((name) => name.toLowerCase() === "att2007.mdb") ??
    mdbs[0];
  return join(dataDir, preferred);
}

async function listTables(mdbPath: string): Promise<string[]> {
  const out = await run("mdb-tables", ["-1", mdbPath]);
  return out
    .split(/\s+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

async function exportTable(mdbPath: string, table: string): Promise<ZktimeRow[]> {
  const out = await run("mdb-json", ["-T", "%Y-%m-%d %H:%M:%S", mdbPath, table]);
  const rows: ZktimeRow[] = [];
  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    rows.push(JSON.parse(trimmed) as ZktimeRow);
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

async function exportIfPresent(mdbPath: string, tables: string[], name: string): Promise<ZktimeRow[]> {
  const found = tables.find((table) => table.toLowerCase() === name.toLowerCase());
  if (!found) {
    return [];
  }
  return exportTable(mdbPath, found);
}

async function countIfPresent(mdbPath: string, tables: string[], name: string): Promise<number> {
  const found = tables.find((table) => table.toLowerCase() === name.toLowerCase());
  if (!found) {
    return 0;
  }
  const out = await run("mdb-count", [mdbPath, found]);
  return Number(out.trim()) || 0;
}

export class MdbStore implements ZktimeStore {
  readonly kind = "mdb" as const;

  constructor(
    private readonly dataDir: string,
    private readonly mdbFile: string,
    private readonly siteName: string,
  ) {}

  private path(): string {
    return resolveMdbFile(this.dataDir, this.mdbFile);
  }

  async inspect(): Promise<{ tables: string[]; columns: Record<string, string[]> }> {
    const mdbPath = this.path();
    const tables = await listTables(mdbPath);
    const columns: Record<string, string[]> = {};
    for (const wanted of MAPPED) {
      const found = tables.find((table) => table.toLowerCase() === wanted.toLowerCase());
      columns[wanted] = found ? await tableColumns(mdbPath, found) : [];
    }
    return { tables, columns };
  }

  async status(): Promise<ZktimeStatus> {
    const mdbPath = this.path();
    const tables = await listTables(mdbPath);
    const [employees, punches, departments, devices] = await Promise.all([
      countIfPresent(mdbPath, tables, "USERINFO"),
      countIfPresent(mdbPath, tables, "CHECKINOUT"),
      countIfPresent(mdbPath, tables, "DEPARTMENTS"),
      countIfPresent(mdbPath, tables, "Machines"),
    ]);
    if (employees === 0 && punches === 0 && !tables.some((t) => t.toLowerCase() === "userinfo")) {
      throw new Error(`ZKTime MDB ${mdbPath} has no USERINFO`);
    }
    const missing = MAPPED.filter((name) => !tables.some((table) => table.toLowerCase() === name.toLowerCase()));
    return {
      ok: true,
      product: "ZKTime",
      vendor: "https://www.zksoftwarecenter.com/",
      backend: "mdb",
      sample: false,
      site_name: this.siteName || undefined,
      source: mdbPath,
      tables,
      employee_count: employees,
      punch_count: punches,
      department_count: departments,
      device_count: devices,
      note: missing.length
        ? `อ่าน Access แล้ว ตารางที่ไม่มี: ${missing.join(", ")}`
        : `อ่าน ZKTime จาก ${mdbPath.split("/").pop()} (USERINFO/CHECKINOUT) — ไม่รวมลายนิ้วมือ/ใบหน้า/รหัสผ่าน`,
    };
  }

  private async roster(): Promise<{
    employees: ZktimeEmployee[];
    departments: ZktimeDepartment[];
    people: Map<number, { badge: string; name: string }>;
  }> {
    const mdbPath = this.path();
    const tables = await listTables(mdbPath);
    const [userinfo, deptRows] = await Promise.all([
      exportIfPresent(mdbPath, tables, "USERINFO"),
      exportIfPresent(mdbPath, tables, "DEPARTMENTS"),
    ]);
    const departments = deptRows
      .map((row) => departmentFromRow(row))
      .filter((row): row is ZktimeDepartment => row != null);
    const names = indexDepartments(departments);
    const employees = userinfo
      .map((row) => employeeFromUserinfo(row, names))
      .filter((row): row is ZktimeEmployee => row != null);
    return { employees, departments, people: indexPeople(employees) };
  }

  async listEmployees(): Promise<ZktimeEmployee[]> {
    return (await this.roster()).employees;
  }

  async listDepartments(): Promise<ZktimeDepartment[]> {
    return (await this.roster()).departments;
  }

  async listDevices(): Promise<ZktimeDevice[]> {
    const mdbPath = this.path();
    const tables = await listTables(mdbPath);
    const rows = await exportIfPresent(mdbPath, tables, "Machines");
    return rows.map((row) => deviceFromRow(row)).filter((row): row is ZktimeDevice => row != null);
  }

  async listPunches(opts: ZktimePunchQuery = {}): Promise<ZktimePunch[]> {
    const mdbPath = this.path();
    const tables = await listTables(mdbPath);
    const { people } = await this.roster();
    const rows = await exportIfPresent(mdbPath, tables, "CHECKINOUT");
    return rows
      .map((row) => punchFromRow(row, people))
      .filter((row): row is ZktimePunch => row != null)
      .filter((row) => {
        if (opts.user_id && row.user_id !== opts.user_id) {
          return false;
        }
        if (!dateInRange(row.check_time, opts.from, opts.to)) {
          return false;
        }
        return matchesQuery(opts.query, row.badge, row.name, row.user_id);
      })
      .sort((a, b) => a.check_time.localeCompare(b.check_time));
  }
}
