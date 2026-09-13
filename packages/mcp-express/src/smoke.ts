import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDbfFile } from "./dbf.js";
import { DbfStore } from "./dbf-store.js";
import { createExpressStore } from "./store.js";

function writeSimpleDbf(
  path: string,
  fields: Array<{ name: string; type: string; length: number }>,
  rows: Record<string, string>[],
): void {
  const recordLen = 1 + fields.reduce((sum, field) => sum + field.length, 0);
  const headerLen = 32 + fields.length * 32 + 1;
  const buf = Buffer.alloc(headerLen + recordLen * rows.length + 1);
  buf[0] = 0x03;
  buf.writeUInt32LE(rows.length, 4);
  buf.writeUInt16LE(headerLen, 8);
  buf.writeUInt16LE(recordLen, 10);
  let offset = 32;
  for (const field of fields) {
    buf.write(field.name.slice(0, 11), offset, "ascii");
    buf[offset + 11] = field.type.charCodeAt(0);
    buf[offset + 16] = field.length;
    offset += 32;
  }
  buf[offset] = 0x0d;
  let cursor = headerLen;
  for (const row of rows) {
    buf[cursor] = 0x20;
    let pos = cursor + 1;
    for (const field of fields) {
      const raw = String(row[field.name] ?? "").slice(0, field.length);
      buf.write(raw.padEnd(field.length, " "), pos, "ascii");
      pos += field.length;
    }
    cursor += recordLen;
  }
  buf[cursor] = 0x1a;
  writeFileSync(path, buf.subarray(0, cursor + 1));
}

async function main(): Promise<void> {
  process.env.EXPRESS_BACKEND = "fixture";
  const store = createExpressStore();
  const books = await store.load();
  if (!books.status.sample || books.customers.length < 1 || books.arInvoices.length < 1) {
    throw new Error("fixture books incomplete");
  }

  const dir = mkdtempSync(join(tmpdir(), "express-dbf-"));
  writeSimpleDbf(
    join(dir, "ARMAS.DBF"),
    [
      { name: "CUSCOD", type: "C", length: 10 },
      { name: "CUSNAM", type: "C", length: 40 },
      { name: "BALANCE", type: "N", length: 12 },
    ],
    [{ CUSCOD: "C100", CUSNAM: "Cafe Sample", BALANCE: "1250.50" }],
  );
  const parsed = readDbfFile(join(dir, "ARMAS.DBF"), "ascii");
  if (parsed.length !== 1 || String(parsed[0]?.CUSCOD).trim() !== "C100") {
    throw new Error(`dbf parse failed: ${JSON.stringify(parsed)}`);
  }
  writeSimpleDbf(
    join(dir, "ARTRN.DBF"),
    [
      { name: "DOCNUM", type: "C", length: 12 },
      { name: "DOCDAT", type: "D", length: 8 },
      { name: "CUSCOD", type: "C", length: 10 },
      { name: "RECTYP", type: "C", length: 1 },
      { name: "NETAMT", type: "N", length: 12 },
      { name: "RCVAMT", type: "N", length: 12 },
      { name: "REMAMT", type: "N", length: 12 },
      { name: "DUEDAT", type: "D", length: 8 },
      { name: "FLGCAN", type: "C", length: 1 },
    ],
    [
      {
        DOCNUM: "IV68090001",
        DOCDAT: "20260902",
        CUSCOD: "C100",
        RECTYP: "3",
        NETAMT: "1250.50",
        RCVAMT: "0",
        REMAMT: "1250.50",
        DUEDAT: "20260930",
        FLGCAN: " ",
      },
      {
        DOCNUM: "IV68080110",
        DOCDAT: "20260818",
        CUSCOD: "C100",
        RECTYP: "3",
        NETAMT: "21000",
        RCVAMT: "21000",
        REMAMT: "0",
        DUEDAT: "20260831",
        FLGCAN: " ",
      },
      {
        DOCNUM: "CN68090002",
        DOCDAT: "20260903",
        CUSCOD: "C100",
        RECTYP: "0",
        NETAMT: "-500",
        RCVAMT: "0",
        REMAMT: "-500",
        DUEDAT: "",
        FLGCAN: " ",
      },
      {
        DOCNUM: "RE68090003",
        DOCDAT: "20260904",
        CUSCOD: "C100",
        RECTYP: "4",
        NETAMT: "100",
        RCVAMT: "100",
        REMAMT: "0",
        DUEDAT: "",
        FLGCAN: " ",
      },
      {
        DOCNUM: "IV68070001",
        DOCDAT: "20260701",
        CUSCOD: "C100",
        RECTYP: "3",
        NETAMT: "9",
        RCVAMT: "0",
        REMAMT: "9",
        DUEDAT: "20260731",
        FLGCAN: "Y",
      },
    ],
  );
  const dbfBooks = await new DbfStore(dir, "ascii", "ทดสอบ DBF").load();
  if (dbfBooks.customers[0]?.code !== "C100" || dbfBooks.status.sample) {
    throw new Error("dbf store mapping failed");
  }
  const byDoc = new Map(dbfBooks.arInvoices.map((row) => [row.doc_no, row]));
  const openIv = byDoc.get("IV68090001");
  if (
    !openIv ||
    openIv.status !== "open" ||
    openIv.customer_name !== "Cafe Sample" ||
    openIv.amount !== 1250.5 ||
    openIv.balance !== 1250.5 ||
    openIv.due_date !== "2026-09-30" ||
    openIv.doc_type !== "3"
  ) {
    throw new Error(`open ARTRN invoice mapping failed: ${JSON.stringify(openIv)}`);
  }
  if (byDoc.get("IV68080110")?.status !== "paid") {
    throw new Error("paid ARTRN invoice mapping failed");
  }
  if (byDoc.get("CN68090002")?.status !== "open" || byDoc.get("CN68090002")?.balance !== -500) {
    throw new Error("credit-note ARTRN mapping failed");
  }
  if (byDoc.has("RE68090003")) {
    throw new Error("receipt RECTYP 4 should not appear as an invoice");
  }
  if (byDoc.get("IV68070001")?.status !== "void") {
    throw new Error("cancelled ARTRN invoice mapping failed");
  }
  if (!dbfBooks.status.note.includes("ARTRN")) {
    throw new Error(`expected ARTRN in status note: ${dbfBooks.status.note}`);
  }

  const nestedRoot = mkdtempSync(join(tmpdir(), "express-root-"));
  mkdirSync(join(nestedRoot, "DATA"));
  writeSimpleDbf(
    join(nestedRoot, "DATA", "ARMAS.DBF"),
    [
      { name: "CUSCOD", type: "C", length: 10 },
      { name: "CUSNAM", type: "C", length: 40 },
      { name: "BALANCE", type: "N", length: 12 },
    ],
    [{ CUSCOD: "C200", CUSNAM: "Nested Co", BALANCE: "10" }],
  );
  const nestedBooks = await new DbfStore(nestedRoot, "ascii", "nested").load();
  if (nestedBooks.customers[0]?.code !== "C200") {
    throw new Error("dbf store did not find ARMAS in DATA subdirectory");
  }
  if (nestedBooks.arInvoices.length !== 0 || !nestedBooks.status.note.includes("ไม่พบ ARTRN")) {
    throw new Error("missing ARTRN should leave invoices empty");
  }

  const datRoot = mkdtempSync(join(tmpdir(), "express-dat-"));
  mkdirSync(join(datRoot, "dat"));
  writeSimpleDbf(
    join(datRoot, "dat", "armas.dbf"),
    [
      { name: "CUSCOD", type: "C", length: 10 },
      { name: "CUSNAM", type: "C", length: 40 },
      { name: "BALANCE", type: "N", length: 12 },
    ],
    [{ CUSCOD: "C300", CUSNAM: "Lower Dat", BALANCE: "3" }],
  );
  writeSimpleDbf(
    join(datRoot, "dat", "artrn.dbf"),
    [
      { name: "DOCNUM", type: "C", length: 12 },
      { name: "DOCDAT", type: "D", length: 8 },
      { name: "CUSCOD", type: "C", length: 10 },
      { name: "NETAMT", type: "N", length: 12 },
      { name: "REMAMT", type: "N", length: 12 },
    ],
    [
      {
        DOCNUM: "IV3001",
        DOCDAT: "20260901",
        CUSCOD: "C300",
        NETAMT: "30",
        REMAMT: "30",
      },
    ],
  );
  const datBooks = await new DbfStore(datRoot, "ascii", "dat-case").load();
  if (datBooks.customers[0]?.code !== "C300") {
    throw new Error("dbf store did not find lowercase armas.dbf in dat/");
  }
  if (datBooks.arInvoices[0]?.doc_no !== "IV3001" || datBooks.arInvoices[0]?.customer_name !== "Lower Dat") {
    throw new Error("dbf store did not find lowercase artrn.dbf in dat/");
  }

  console.log("express fixture smoke ok", books.status.company_name, books.customers.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
