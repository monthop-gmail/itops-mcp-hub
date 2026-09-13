import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pickNumber, pickString, readDbfFile, type DbfRow } from "./dbf.js";
import type {
  ExpressBooks,
  ExpressGlAccount,
  ExpressInvoice,
  ExpressItem,
  ExpressParty,
  ExpressStore,
} from "./types.js";

const MASTER_TABLES = ["ARMAS", "APMAS", "STMAS", "GLMAS"] as const;

function findTable(dir: string, base: string): string | null {
  const wanted = `${base}.dbf`.toLowerCase();
  try {
    for (const name of readdirSync(dir)) {
      if (name.toLowerCase() === wanted) {
        return join(dir, name);
      }
    }
  } catch {
    return null;
  }
  return null;
}

function masterCount(dir: string): number {
  return MASTER_TABLES.filter((name) => findTable(dir, name)).length;
}

function childDirectories(dir: string): string[] {
  try {
    return readdirSync(dir)
      .map((name) => join(dir, name))
      .filter((path) => {
        try {
          return statSync(path).isDirectory();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

/**
 * Express install dirs (e.g. C:\ExpressI) often keep masters in a company
 * or DATA subdirectory. Prefer the folder with the most ARMAS/APMAS/STMAS/GLMAS.
 */
export function resolveExpressDataDir(root: string): string {
  const preferredNames = new Set(["data", "dat", "dbf", "company", "data1"]);
  const candidates = [root, ...childDirectories(root)];
  let best = root;
  let bestScore = masterCount(root);
  for (const dir of candidates) {
    const score = masterCount(dir);
    if (score > bestScore) {
      best = dir;
      bestScore = score;
      continue;
    }
    if (score === bestScore && score > 0 && preferredNames.has(dir.split(/[\\/]/).pop()?.toLowerCase() ?? "")) {
      best = dir;
    }
  }
  if (bestScore === 0) {
    for (const child of childDirectories(root)) {
      for (const nested of childDirectories(child)) {
        const score = masterCount(nested);
        if (score > bestScore) {
          best = nested;
          bestScore = score;
        }
      }
    }
  }
  return best;
}

export class DbfStore implements ExpressStore {
  readonly kind = "dbf" as const;

  constructor(
    private readonly dataDir: string,
    private readonly encoding: string,
    private readonly companyName: string,
  ) {}

  async load(): Promise<ExpressBooks> {
    const resolved = resolveExpressDataDir(this.dataDir);
    const armas = findTable(resolved, "ARMAS");
    const apmas = findTable(resolved, "APMAS");
    const stmas = findTable(resolved, "STMAS");
    const glmas = findTable(resolved, "GLMAS");
    const artrn = findTable(resolved, "ARTRN");
    if (!armas && !apmas && !stmas) {
      throw new Error(
        `No Express DBF masters in ${this.dataDir} (expected ARMAS.DBF / APMAS.DBF / STMAS.DBF under the folder or one level down)`,
      );
    }
    const customers = armas
      ? readDbfFile(armas, this.encoding).map((row) => partyFromRow(row, "customer"))
      : [];
    const vendors = apmas
      ? readDbfFile(apmas, this.encoding).map((row) => partyFromRow(row, "vendor"))
      : [];
    const items = stmas ? readDbfFile(stmas, this.encoding).map(itemFromRow) : [];
    const glAccounts = glmas ? readDbfFile(glmas, this.encoding).map(glFromRow) : [];
    const visibleCustomers = customers.filter((row) => row.code || row.name);
    const arInvoices = artrn
      ? invoicesFromArtrn(readDbfFile(artrn, this.encoding), visibleCustomers)
      : [];
    const arNote = artrn
      ? `; ใบแจ้งหนี้จาก ARTRN (${arInvoices.length} ใบ)`
      : "; ไม่พบ ARTRN.DBF จึงยังไม่มีใบแจ้งหนี้";
    return {
      status: {
        ok: true,
        product: "Express Accounting",
        vendor: "https://express.co.th/",
        backend: "dbf",
        company_name: this.companyName,
        sample: false,
        note: `อ่าน DBF จาก ${resolved} แบบอ่านอย่างเดียว (Visual FoxPro / windows-874)${arNote}`,
      },
      customers: visibleCustomers,
      vendors: vendors.filter((row) => row.code || row.name),
      items: items.filter((row) => row.code || row.name),
      arInvoices,
      glAccounts: glAccounts.filter((row) => row.code || row.name),
    };
  }
}

function partyFromRow(
  row: Record<string, string | number | boolean | null>,
  kind: "customer" | "vendor",
): ExpressParty {
  const codeKeys =
    kind === "customer" ? ["CUSCOD", "CUSTCOD", "CODE", "ARCOD"] : ["SUPCOD", "VENCOD", "CODE", "APCOD"];
  const nameKeys =
    kind === "customer" ? ["CUSNAM", "CUSTNAM", "NAME", "ARNAM"] : ["SUPNAM", "VENNAM", "NAME", "APNAM"];
  return {
    code: pickString(row, codeKeys),
    name: pickString(row, nameKeys),
    tax_id: pickString(row, ["TAXID", "TAX_ID", "IDNO"]) || undefined,
    phone: pickString(row, ["TELNUM", "TEL", "PHONE"]) || undefined,
    address: [pickString(row, ["ADDR01", "ADDR1", "ADDRESS"]), pickString(row, ["ADDR02", "ADDR2"])]
      .filter(Boolean)
      .join(" ") || undefined,
    balance: pickNumber(row, ["BALANCE", "BALANC", "AREBAL", "APBALE", "NETBAL"]),
  };
}

function itemFromRow(row: Record<string, string | number | boolean | null>): ExpressItem {
  return {
    code: pickString(row, ["STKCOD", "ITEMCOD", "CODE"]),
    name: pickString(row, ["STKDES", "STKNAM", "NAME", "DESC"]),
    unit: pickString(row, ["STKUNT", "UNIT", "QU"]) || undefined,
    on_hand: pickNumber(row, ["ONHAND", "QTY", "BALANC", "STKBAL"]),
    unit_price: pickNumber(row, ["SELLPR", "PRICE", "UNITPR"]),
  };
}

const PAID_EPS = 0.005;

function invoicesFromArtrn(rows: DbfRow[], customers: ExpressParty[]): ExpressInvoice[] {
  const names = new Map(customers.filter((row) => row.code).map((row) => [row.code, row.name]));
  const invoices: ExpressInvoice[] = [];
  for (const row of rows) {
    const invoice = invoiceFromArtrnRow(row, names);
    if (invoice) {
      invoices.push(invoice);
    }
  }
  invoices.sort((a, b) => `${b.doc_date}${b.doc_no}`.localeCompare(`${a.doc_date}${a.doc_no}`));
  return invoices;
}

function invoiceFromArtrnRow(row: DbfRow, names: Map<string, string>): ExpressInvoice | null {
  const docNo = pickString(row, ["DOCNUM", "INVNUM", "IVCNUM", "DOCNO"]);
  const customerCode = pickString(row, ["CUSCOD", "CUSTCOD", "ARCOD"]);
  if (!docNo || !customerCode) {
    return null;
  }
  const recTyp = pickString(row, ["RECTYP", "DOCTYPE", "DOCTYP"]);
  if (isReceiptType(recTyp)) {
    return null;
  }
  const amount = pickNumber(row, ["NETAMT", "IVCAMT", "TOTAL", "AMOUNT", "AMT"]) ?? 0;
  const received = pickNumber(row, ["RCVAMT", "PAYAMT"]) ?? 0;
  const balance = pickNumber(row, ["REMAMT", "BALANCE", "AREBAL"]) ?? amount - received;
  const dueDate = pickString(row, ["DUEDAT", "DUE_DATE", "DUEDATE"]) || undefined;
  const status: ExpressInvoice["status"] = isCancelled(row)
    ? "void"
    : Math.abs(balance) < PAID_EPS
      ? "paid"
      : "open";
  return {
    doc_no: docNo,
    doc_date: pickString(row, ["DOCDAT", "INVDATE", "DATE"]),
    customer_code: customerCode,
    customer_name: names.get(customerCode) || pickString(row, ["CUSNAM", "CUSTNAM", "ARNAM"]),
    amount,
    balance,
    status,
    due_date: dueDate,
    doc_type: recTyp || undefined,
  };
}

/** Receipts live mainly in ARRCPIT; RECTYP 4 is ใบเสร็จ in common Express charts. */
function isReceiptType(recTyp: string): boolean {
  const t = recTyp.trim().toUpperCase();
  return t === "4" || t === "R" || t === "RC" || t === "RE";
}

function isCancelled(row: DbfRow): boolean {
  for (const key of ["FLGCAN", "FLGDEL", "CANCEL", "VOID", "FLGVOID"] as const) {
    const value = row[key];
    if (value === true) {
      return true;
    }
    if (typeof value === "string") {
      const u = value.trim().toUpperCase();
      if (["T", "Y", "1", "C", "V", "YES", "TRUE"].includes(u)) {
        return true;
      }
    }
  }
  return false;
}

function glFromRow(row: Record<string, string | number | boolean | null>): ExpressGlAccount {
  const code = pickString(row, ["ACCNUM", "ACCCOD", "CODE", "GLCOD"]);
  const name = pickString(row, ["ACCNAM", "ACCNAME", "NAME"]);
  const typeRaw = pickString(row, ["ACCTYP", "TYPE"]).toLowerCase();
  let type: ExpressGlAccount["type"] = "asset";
  if (typeRaw.includes("liab") || typeRaw === "l" || typeRaw.includes("หนี้")) {
    type = "liability";
  } else if (typeRaw.includes("eq") || typeRaw === "q" || typeRaw.includes("ทุน")) {
    type = "equity";
  } else if (typeRaw.includes("inc") || typeRaw === "i" || typeRaw.includes("ได้")) {
    type = "income";
  } else if (typeRaw.includes("exp") || typeRaw === "e" || typeRaw.includes("ใช้")) {
    type = "expense";
  }
  return {
    code,
    name,
    type,
    balance: pickNumber(row, ["BALANCE", "BALANC", "ENDBAL"]) ?? 0,
  };
}
