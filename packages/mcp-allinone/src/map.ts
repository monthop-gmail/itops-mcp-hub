import type {
  AllinoneGlAccount,
  AllinoneInvoice,
  AllinoneItem,
  AllinoneParty,
  AllinoneRow,
} from "./types.js";

const RECEIPT_PREFIXES = new Set(["RC", "RE", "CH", "RV", "CN"]);

export function cell(row: AllinoneRow, ...keys: string[]): unknown {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  for (const [name, value] of Object.entries(row)) {
    if (wanted.has(name.toLowerCase())) {
      return value;
    }
  }
  return undefined;
}

export function asString(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return "";
    }
    return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

export function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const raw = asString(value).replace(/,/g, "");
  if (!raw) {
    return 0;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function asDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = asString(value);
  if (!raw) {
    return "";
  }
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (us) {
    const month = us[1].padStart(2, "0");
    const day = us[2].padStart(2, "0");
    let year = us[3];
    if (year.length === 2) {
      year = Number(year) >= 70 ? `19${year}` : `20${year}`;
    }
    return `${year}-${month}-${day}`;
  }
  return raw.slice(0, 10);
}

export function partyFromMaster(row: AllinoneRow): AllinoneParty {
  const code = asString(cell(row, "ACCID"));
  const company = asString(cell(row, "COMP"));
  const contact = asString(cell(row, "NAME"));
  const add1 = asString(cell(row, "ADD_1"));
  const add2 = asString(cell(row, "ADD_2"));
  return {
    code,
    name: company || contact || code,
    contact: contact && contact !== company ? contact : undefined,
    tax_id: asString(cell(row, "TAXNO")) || undefined,
    phone: asString(cell(row, "TEL")) || undefined,
    address: [add1, add2].filter(Boolean).join(" ") || undefined,
    balance: asNumber(cell(row, "NOWBAL")),
  };
}

export function itemFromInvmst(row: AllinoneRow): AllinoneItem {
  return {
    code: asString(cell(row, "ID")),
    name: asString(cell(row, "DESC", "NAME")) || asString(cell(row, "ID")),
    unit: asString(cell(row, "UNIT")) || undefined,
    on_hand: asNumber(cell(row, "NOWBAL")),
    unit_price: asNumber(cell(row, "PRICE1")),
  };
}

export function invoiceFromArtr(
  row: AllinoneRow,
  names: Map<string, string>,
): AllinoneInvoice | null {
  const docNo = asString(cell(row, "DOCNO"));
  if (!docNo) {
    return null;
  }
  const prefix = docNo.slice(0, 2).toUpperCase();
  if (RECEIPT_PREFIXES.has(prefix)) {
    return null;
  }
  const voidFlag = asString(cell(row, "VOID")).toUpperCase();
  const amount = asNumber(cell(row, "AMOUNT_D", "INVAMT", "AMOUNT_B"));
  const balance = asNumber(cell(row, "NBAL"));
  const customerCode = asString(cell(row, "ACCID"));
  let status: AllinoneInvoice["status"] = "open";
  if (voidFlag === "Y" || voidFlag === "1" || voidFlag === "V") {
    status = "void";
  } else if (Math.abs(balance) < 0.009) {
    status = "paid";
  }
  return {
    doc_no: docNo,
    doc_date: asDate(cell(row, "DATEDOC")),
    customer_code: customerCode,
    customer_name: names.get(customerCode) || customerCode,
    amount,
    balance,
    status,
    due_date: asDate(cell(row, "DUEDATE")) || undefined,
  };
}

export function glFromGlmst(row: AllinoneRow): AllinoneGlAccount {
  const group = asString(cell(row, "GROUP")).toUpperCase();
  const nature = asString(cell(row, "NATURE")).toUpperCase();
  let type: AllinoneGlAccount["type"] = nature === "C" ? "liability" : "asset";
  if (group.startsWith("A")) {
    type = "asset";
  } else if (group.startsWith("L")) {
    type = "liability";
  } else if (group.startsWith("O")) {
    type = "equity";
  } else if (group.startsWith("R") || group.startsWith("I")) {
    type = "income";
  } else if (group.startsWith("E")) {
    type = "expense";
  }
  return {
    code: asString(cell(row, "GLID")),
    name: asString(cell(row, "NAME")),
    type,
    balance: asNumber(cell(row, "NOWBAL", "BAL_13")),
  };
}

export function companyFromConfig(rows: AllinoneRow[]): string {
  const first = rows[0];
  if (!first) {
    return "";
  }
  return asString(cell(first, "COMPNAME"));
}

export function indexNames(parties: AllinoneParty[]): Map<string, string> {
  return new Map(parties.map((row) => [row.code, row.name]));
}
