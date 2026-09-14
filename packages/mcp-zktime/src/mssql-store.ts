import sql from "mssql";
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

export interface MssqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  encrypt: boolean;
  siteName: string;
}

const WANTED: Record<string, string[]> = {
  USERINFO: ["USERID", "Badgenumber", "BADGENUMBER", "Name", "NAME", "Gender", "GENDER", "TITLE", "DEFAULTDEPTID", "HIREDDAY", "CardNo", "CARDNO"],
  CHECKINOUT: ["USERID", "CHECKTIME", "CHECKTYPE", "VERIFYCODE", "SENSORID", "Memoinfo", "MEMOINFO", "sn", "SN", "WorkCode", "WORKCODE"],
  DEPARTMENTS: ["DEPTID", "DEPTNAME", "SUPDEPTID"],
  Machines: ["ID", "MachineAlias", "ConnectType", "IP", "SerialPort", "Port", "Baudrate", "MachineNumber", "Enabled", "sn", "SN", "FirmwareVersion", "ProductType", "usercount"],
};

const FORBIDDEN = new Set(
  ["SSN", "PASSWORD", "PHOTO", "MVERIFYPASS", "COMMPASSWORD", "TEMPLATE", "FACETEMP"].map((n) => n.toLowerCase()),
);

function quoteIdent(name: string): string {
  return `[${name.replace(/]/g, "]]")}]`;
}

export class MssqlStore implements ZktimeStore {
  readonly kind = "mssql" as const;

  constructor(private readonly config: MssqlConfig) {}

  private async connect(): Promise<sql.ConnectionPool> {
    return new sql.ConnectionPool({
      server: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
      options: {
        encrypt: this.config.encrypt,
        trustServerCertificate: true,
        enableArithAbort: true,
      },
      requestTimeout: 15000,
      connectionTimeout: 8000,
    }).connect();
  }

  private async tableNames(pool: sql.ConnectionPool): Promise<string[]> {
    const result = await pool.request().query<{ name: string }>(
      "SELECT name FROM sysobjects WHERE xtype = 'U' ORDER BY name",
    );
    return result.recordset.map((row) => row.name);
  }

  private async columnsOf(pool: sql.ConnectionPool, table: string): Promise<string[]> {
    const result = await pool
      .request()
      .input("table", sql.VarChar, table)
      .query<{ COLUMN_NAME: string }>(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @table ORDER BY ORDINAL_POSITION",
      );
    return result.recordset.map((row) => row.COLUMN_NAME);
  }

  private findTable(tables: string[], name: string): string | undefined {
    return tables.find((table) => table.toLowerCase() === name.toLowerCase());
  }

  private async selectMapped(
    pool: sql.ConnectionPool,
    tables: string[],
    logical: string,
  ): Promise<ZktimeRow[]> {
    const table = this.findTable(tables, logical);
    if (!table) {
      return [];
    }
    const columns = await this.columnsOf(pool, table);
    const wanted = new Set((WANTED[logical] ?? []).map((name) => name.toLowerCase()));
    const selected = columns.filter(
      (col) => wanted.has(col.toLowerCase()) && !FORBIDDEN.has(col.toLowerCase()),
    );
    if (selected.length === 0) {
      return [];
    }
    const result = await pool.request().query(
      `SELECT ${selected.map(quoteIdent).join(", ")} FROM ${quoteIdent(table)}`,
    );
    return result.recordset as ZktimeRow[];
  }

  async inspect(): Promise<{ tables: string[]; columns: Record<string, string[]> }> {
    const pool = await this.connect();
    try {
      const tables = await this.tableNames(pool);
      const columns: Record<string, string[]> = {};
      for (const wanted of Object.keys(WANTED)) {
        const found = this.findTable(tables, wanted);
        columns[wanted] = found ? await this.columnsOf(pool, found) : [];
      }
      return { tables, columns };
    } finally {
      await pool.close();
    }
  }

  async status(): Promise<ZktimeStatus> {
    const pool = await this.connect();
    try {
      const tables = await this.tableNames(pool);
      const counts: Record<string, number> = {};
      for (const name of ["USERINFO", "CHECKINOUT", "DEPARTMENTS", "Machines"]) {
        const found = this.findTable(tables, name);
        if (!found) {
          counts[name] = 0;
          continue;
        }
        const result = await pool.request().query<{ n: number }>(
          `SELECT COUNT(*) AS n FROM ${quoteIdent(found)}`,
        );
        counts[name] = Number(result.recordset[0]?.n ?? 0);
      }
      if (!this.findTable(tables, "USERINFO") && !this.findTable(tables, "CHECKINOUT")) {
        throw new Error(`ZKTime SQL Server ${this.config.database} has no USERINFO/CHECKINOUT`);
      }
      const missing = Object.keys(WANTED).filter((name) => !this.findTable(tables, name));
      return {
        ok: true,
        product: "ZKTime",
        vendor: "https://www.zksoftwarecenter.com/",
        backend: "mssql",
        sample: false,
        site_name: this.config.siteName || undefined,
        source: `${this.config.host}/${this.config.database}`,
        tables,
        employee_count: counts.USERINFO,
        punch_count: counts.CHECKINOUT,
        department_count: counts.DEPARTMENTS,
        device_count: counts.Machines,
        note: missing.length
          ? `อ่าน SQL Server แล้ว ตารางที่ไม่มี: ${missing.join(", ")}`
          : `อ่าน ZKTime SQL Server (${this.config.database}) แบบ SELECT อย่างเดียว — ไม่รวมลายนิ้วมือ/ใบหน้า/รหัสผ่าน`,
      };
    } finally {
      await pool.close();
    }
  }

  private async roster(pool: sql.ConnectionPool, tables: string[]): Promise<{
    employees: ZktimeEmployee[];
    departments: ZktimeDepartment[];
    people: Map<number, { badge: string; name: string }>;
  }> {
    const [userinfo, deptRows] = await Promise.all([
      this.selectMapped(pool, tables, "USERINFO"),
      this.selectMapped(pool, tables, "DEPARTMENTS"),
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
    const pool = await this.connect();
    try {
      return (await this.roster(pool, await this.tableNames(pool))).employees;
    } finally {
      await pool.close();
    }
  }

  async listDepartments(): Promise<ZktimeDepartment[]> {
    const pool = await this.connect();
    try {
      return (await this.roster(pool, await this.tableNames(pool))).departments;
    } finally {
      await pool.close();
    }
  }

  async listDevices(): Promise<ZktimeDevice[]> {
    const pool = await this.connect();
    try {
      const tables = await this.tableNames(pool);
      const rows = await this.selectMapped(pool, tables, "Machines");
      return rows.map((row) => deviceFromRow(row)).filter((row): row is ZktimeDevice => row != null);
    } finally {
      await pool.close();
    }
  }

  async listPunches(opts: ZktimePunchQuery = {}): Promise<ZktimePunch[]> {
    const pool = await this.connect();
    try {
      const tables = await this.tableNames(pool);
      const found = this.findTable(tables, "CHECKINOUT");
      if (!found) {
        return [];
      }
      const { people } = await this.roster(pool, tables);
      const columns = await this.columnsOf(pool, found);
      const wanted = new Set(WANTED.CHECKINOUT.map((name) => name.toLowerCase()));
      const selected = columns.filter((col) => wanted.has(col.toLowerCase()));
      const request = pool.request();
      const where: string[] = [];
      if (opts.from) {
        request.input("from", sql.VarChar, `${opts.from.slice(0, 10)} 00:00:00`);
        where.push("CHECKTIME >= CONVERT(datetime, @from, 120)");
      }
      if (opts.to) {
        request.input("to", sql.VarChar, `${opts.to.slice(0, 10)} 23:59:59`);
        where.push("CHECKTIME <= CONVERT(datetime, @to, 120)");
      }
      if (opts.user_id) {
        request.input("userid", sql.Int, opts.user_id);
        where.push("USERID = @userid");
      }
      const sqlText = `SELECT TOP 5000 ${selected.map(quoteIdent).join(", ")} FROM ${quoteIdent(found)}${
        where.length ? ` WHERE ${where.join(" AND ")}` : ""
      } ORDER BY CHECKTIME`;
      const result = await request.query(sqlText);
      return (result.recordset as ZktimeRow[])
        .map((row) => punchFromRow(row, people))
        .filter((row): row is ZktimePunch => row != null)
        .filter((row) => matchesQuery(opts.query, row.badge, row.name, row.user_id))
        .filter((row) => dateInRange(row.check_time, opts.from, opts.to));
    } finally {
      await pool.close();
    }
  }
}
