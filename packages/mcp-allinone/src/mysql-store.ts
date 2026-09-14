import mysql from "mysql2/promise";
import {
  companyFromConfig,
  glFromGlmst,
  indexNames,
  invoiceFromArtr,
  itemFromInvmst,
  partyFromMaster,
} from "./map.js";
import type { AllinoneBooks, AllinoneRow, AllinoneStore } from "./types.js";

export interface MysqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  companyName: string;
}

const SELECTS: Record<string, string> = {
  ARMST: "SELECT ACCID, COMP, NAME, ADD_1, ADD_2, TEL, TAXNO, NOWBAL FROM `ARMST`",
  APMST: "SELECT ACCID, COMP, NAME, ADD_1, ADD_2, TEL, TAXNO, NOWBAL FROM `APMST`",
  INVMST: "SELECT ID, `DESC`, UNIT, NOWBAL, PRICE1 FROM `INVMST`",
  ARTR: "SELECT DOCNO, DATEDOC, DUEDATE, ACCID, AMOUNT_D, AMOUNT_B, INVAMT, RECAMT, NBAL, VOID FROM `ARTR`",
  GLMST: "SELECT GLID, NAME, `GROUP`, NATURE, NOWBAL, BAL_13 FROM `GLMST`",
  CONFIG: "SELECT COMPNAME FROM `CONFIG`",
};

async function tableNames(conn: mysql.Connection): Promise<string[]> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>("SHOW TABLES");
  return rows.map((row) => String(Object.values(row)[0] ?? ""));
}

async function selectIfPresent(
  conn: mysql.Connection,
  tables: string[],
  name: string,
): Promise<AllinoneRow[]> {
  if (!tables.some((table) => table.toLowerCase() === name.toLowerCase())) {
    return [];
  }
  const sql = SELECTS[name];
  const [rows] = await conn.query<mysql.RowDataPacket[]>(sql);
  return rows as AllinoneRow[];
}

export class MysqlStore implements AllinoneStore {
  readonly kind = "mysql" as const;

  constructor(private readonly config: MysqlConfig) {}

  private connect(): Promise<mysql.Connection> {
    return mysql.createConnection({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
      decimalNumbers: true,
      connectTimeout: 8000,
    });
  }

  async inspect(): Promise<{ tables: string[]; columns: Record<string, string[]> }> {
    const conn = await this.connect();
    try {
      const tables = await tableNames(conn);
      const columns: Record<string, string[]> = {};
      for (const wanted of Object.keys(SELECTS)) {
        if (!tables.some((table) => table.toLowerCase() === wanted.toLowerCase())) {
          columns[wanted] = [];
          continue;
        }
        const [rows] = await conn.query<mysql.RowDataPacket[]>(`DESCRIBE \`${wanted}\``);
        columns[wanted] = rows.map((row) => String(row.Field ?? ""));
      }
      return { tables, columns };
    } finally {
      await conn.end();
    }
  }

  async load(): Promise<AllinoneBooks> {
    const conn = await this.connect();
    try {
      await conn.query("SET SESSION TRANSACTION READ ONLY");
      const tables = await tableNames(conn);
      const [armst, apmst, invmst, artr, glmst, config] = await Promise.all([
        selectIfPresent(conn, tables, "ARMST"),
        selectIfPresent(conn, tables, "APMST"),
        selectIfPresent(conn, tables, "INVMST"),
        selectIfPresent(conn, tables, "ARTR"),
        selectIfPresent(conn, tables, "GLMST"),
        selectIfPresent(conn, tables, "CONFIG"),
      ]);
      if (armst.length === 0 && apmst.length === 0 && invmst.length === 0) {
        throw new Error(
          `Allinone MySQL ${this.config.database} has no ARMST/APMST/INVMST — is this CS books?`,
        );
      }
      const customers = armst.map((row) => partyFromMaster(row)).filter((row) => row.code);
      const names = indexNames(customers);
      const company = this.config.companyName || companyFromConfig(config) || "Allinone CS";
      const missing = Object.keys(SELECTS).filter(
        (name) => !tables.some((table) => table.toLowerCase() === name.toLowerCase()),
      );
      return {
        status: {
          ok: true,
          product: "Allinone",
          vendor: "https://www.allinonesoft.com/",
          edition: "cs",
          backend: "mysql",
          company_name: company,
          sample: false,
          source: `${this.config.host}/${this.config.database}`,
          tables,
          note: missing.length
            ? `อ่าน MySQL แล้ว ตารางที่ไม่มี: ${missing.join(", ")}`
            : `อ่าน Allinone CS MySQL (${this.config.database}) แบบ SELECT อย่างเดียว`,
        },
        customers,
        vendors: apmst.map((row) => partyFromMaster(row)).filter((row) => row.code),
        items: invmst.map((row) => itemFromInvmst(row)).filter((row) => row.code),
        arInvoices: artr
          .map((row) => invoiceFromArtr(row, names))
          .filter((row): row is NonNullable<typeof row> => row != null),
        glAccounts: glmst.map((row) => glFromGlmst(row)).filter((row) => row.code),
      };
    } finally {
      await conn.end();
    }
  }
}
