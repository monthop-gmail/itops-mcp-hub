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
  const dbfBooks = await new DbfStore(dir, "ascii", "ทดสอบ DBF").load();
  if (dbfBooks.customers[0]?.code !== "C100" || dbfBooks.status.sample) {
    throw new Error("dbf store mapping failed");
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

  console.log("express fixture smoke ok", books.status.company_name, books.customers.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
