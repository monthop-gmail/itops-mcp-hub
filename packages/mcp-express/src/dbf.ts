import { readFileSync } from "node:fs";

export type DbfRow = Record<string, string | number | boolean | null>;

/** TIS-620 / windows-874 — Node alpine ICU often lacks this encoding. */
function decodeWindows874(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    if (b === 0) {
      continue;
    }
    if (b < 0x80) {
      out += String.fromCharCode(b);
    } else if (b >= 0xa1 && b <= 0xda) {
      out += String.fromCharCode(0x0e01 + (b - 0xa1));
    } else if (b >= 0xdf && b <= 0xfb) {
      out += String.fromCharCode(0x0e3f + (b - 0xdf));
    } else {
      out += String.fromCharCode(b);
    }
  }
  return out.trim();
}

function decodeText(bytes: Uint8Array, encoding: string): string {
  const normalized = encoding.toLowerCase().replace(/_/g, "-");
  if (
    normalized === "windows-874" ||
    normalized === "win874" ||
    normalized === "tis-620" ||
    normalized === "tis620" ||
    normalized === "iso-8859-11"
  ) {
    return decodeWindows874(bytes);
  }
  try {
    return new TextDecoder(encoding).decode(bytes).replace(/\0/g, "").trim();
  } catch {
    return Buffer.from(bytes).toString("latin1").replace(/\0/g, "").trim();
  }
}

function readUInt16LE(buf: Buffer, offset: number): number {
  return buf.readUInt16LE(offset);
}

function readUInt32LE(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset);
}

interface Field {
  name: string;
  type: string;
  length: number;
  decimals: number;
}

/**
 * Minimal dBase III / Visual FoxPro table reader (no memo fields).
 * Express Accounting on-prem stores masters as ARMAS/APMAS/STMAS .DBF
 */
export function readDbfFile(path: string, encoding = "windows-874"): DbfRow[] {
  const buf = readFileSync(path);
  if (buf.length < 64) {
    throw new Error(`DBF too small: ${path}`);
  }
  const headerLen = readUInt16LE(buf, 8);
  const recordLen = readUInt16LE(buf, 10);
  const recordCount = readUInt32LE(buf, 4);
  const fields: Field[] = [];
  let offset = 32;
  while (offset < headerLen - 1 && buf[offset] !== 0x0d) {
    const name = decodeText(buf.subarray(offset, offset + 11), "ascii");
    const type = String.fromCharCode(buf[offset + 11] ?? 67);
    const length = buf[offset + 16] ?? 0;
    const decimals = buf[offset + 17] ?? 0;
    if (name) {
      fields.push({ name: name.toUpperCase(), type, length, decimals });
    }
    offset += 32;
  }
  const rows: DbfRow[] = [];
  let cursor = headerLen;
  for (let i = 0; i < recordCount && cursor + recordLen <= buf.length; i += 1) {
    const deleted = buf[cursor] === 0x2a;
    let pos = cursor + 1;
    const row: DbfRow = {};
    for (const field of fields) {
      const slice = buf.subarray(pos, pos + field.length);
      pos += field.length;
      if (deleted) {
        continue;
      }
      row[field.name] = parseField(slice, field, encoding);
    }
    if (!deleted) {
      rows.push(row);
    }
    cursor += recordLen;
  }
  return rows;
}

function parseField(slice: Buffer, field: Field, encoding: string): string | number | boolean | null {
  if (field.type === "N" || field.type === "F" || field.type === "Y" || field.type === "B" || field.type === "I") {
    const raw = decodeText(slice, "ascii");
    if (!raw) {
      return null;
    }
    const num = Number(raw);
    return Number.isFinite(num) ? num : raw;
  }
  if (field.type === "L") {
    const mark = String.fromCharCode(slice[0] ?? 32).toUpperCase();
    return mark === "T" || mark === "Y";
  }
  if (field.type === "D") {
    const raw = decodeText(slice, "ascii");
    if (raw.length === 8) {
      return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    }
    return raw || null;
  }
  return decodeText(slice, encoding) || null;
}

export function pickString(row: DbfRow, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

export function pickNumber(row: DbfRow, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const num = Number(value.replace(/,/g, ""));
      if (Number.isFinite(num)) {
        return num;
      }
    }
  }
  return undefined;
}
