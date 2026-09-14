import type {
  PunchKind,
  ZktimeDepartment,
  ZktimeDevice,
  ZktimeEmployee,
  ZktimePunch,
  ZktimeRow,
} from "./types.js";

export function cell(row: ZktimeRow, ...keys: string[]): unknown {
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
    return formatLocalDateTime(value);
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

export function asBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value !== 0;
  }
  const raw = asString(value).toLowerCase();
  if (!raw) {
    return undefined;
  }
  if (raw === "true" || raw === "1" || raw === "-1" || raw === "yes") {
    return true;
  }
  if (raw === "false" || raw === "0" || raw === "no") {
    return false;
  }
  return undefined;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatLocalDateTime(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

export function asDate(value: unknown): string {
  const dt = asDateTime(value);
  return dt ? dt.slice(0, 10) : "";
}

export function asDateTime(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatLocalDateTime(value);
  }
  const raw = asString(value);
  if (!raw) {
    return "";
  }
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    const time = iso[4]
      ? `${iso[4].padStart(2, "0")}:${iso[5]}:${(iso[6] ?? "00").padStart(2, "0")}`
      : "00:00:00";
    return `${iso[1]}-${iso[2]}-${iso[3]} ${time}`;
  }
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (us) {
    const month = us[1].padStart(2, "0");
    const day = us[2].padStart(2, "0");
    let year = us[3];
    if (year.length === 2) {
      year = Number(year) >= 70 ? `19${year}` : `20${year}`;
    }
    const time = us[4]
      ? `${us[4].padStart(2, "0")}:${us[5]}:${(us[6] ?? "00").padStart(2, "0")}`
      : "00:00:00";
    return `${year}-${month}-${day} ${time}`;
  }
  return raw.slice(0, 19);
}

export function punchKind(raw: unknown): PunchKind {
  const value = asString(raw).toUpperCase();
  if (value === "I" || value === "0" || value === "IN" || value === "CHECK-IN") {
    return "in";
  }
  if (value === "O" || value === "1" || value === "OUT" || value === "CHECK-OUT") {
    return "out";
  }
  return "unknown";
}

export function employeeFromUserinfo(
  row: ZktimeRow,
  departments: Map<number, string>,
): ZktimeEmployee | null {
  const userId = asNumber(cell(row, "USERID"));
  if (!userId) {
    return null;
  }
  const badge = asString(cell(row, "Badgenumber", "BADGENUMBER")) || String(userId);
  const name = asString(cell(row, "Name", "NAME"));
  const departmentId = asNumber(cell(row, "DEFAULTDEPTID"));
  const title = asString(cell(row, "TITLE"));
  const gender = asString(cell(row, "Gender", "GENDER"));
  const cardNo = asString(cell(row, "CardNo", "CARDNO"));
  const hired = asDate(cell(row, "HIREDDAY"));
  return {
    user_id: userId,
    badge,
    name: name || badge,
    department_id: departmentId || undefined,
    department: departmentId ? departments.get(departmentId) : undefined,
    title: title || undefined,
    gender: gender || undefined,
    card_no: cardNo || undefined,
    hired_on: hired || undefined,
  };
}

export function departmentFromRow(row: ZktimeRow): ZktimeDepartment | null {
  const id = asNumber(cell(row, "DEPTID"));
  const name = asString(cell(row, "DEPTNAME"));
  if (!id && !name) {
    return null;
  }
  const parent = asNumber(cell(row, "SUPDEPTID"));
  return {
    id,
    name: name || String(id),
    parent_id: parent || undefined,
  };
}

export function deviceFromRow(row: ZktimeRow): ZktimeDevice | null {
  const id = asNumber(cell(row, "ID"));
  const alias = asString(cell(row, "MachineAlias"));
  if (!id && !alias) {
    return null;
  }
  const ip = asString(cell(row, "IP"));
  const serial = asString(cell(row, "sn", "SN"));
  const product = asString(cell(row, "ProductType"));
  const firmware = asString(cell(row, "FirmwareVersion"));
  return {
    id,
    alias: alias || `device-${id}`,
    ip: ip || undefined,
    port: asNumber(cell(row, "Port")) || undefined,
    enabled: asBool(cell(row, "Enabled")),
    serial: serial || undefined,
    machine_number: asNumber(cell(row, "MachineNumber")) || undefined,
    product_type: product || undefined,
    firmware: firmware || undefined,
    user_count: asNumber(cell(row, "usercount")) || undefined,
  };
}

export function punchFromRow(
  row: ZktimeRow,
  people: Map<number, { badge: string; name: string }>,
): ZktimePunch | null {
  const userId = asNumber(cell(row, "USERID"));
  const checkTime = asDateTime(cell(row, "CHECKTIME"));
  if (!userId || !checkTime) {
    return null;
  }
  const rawType = asString(cell(row, "CHECKTYPE"));
  const person = people.get(userId);
  const sensor = asString(cell(row, "SENSORID"));
  const serial = asString(cell(row, "sn", "SN"));
  const workCode = asString(cell(row, "WorkCode", "WORKCODE"));
  return {
    user_id: userId,
    badge: person?.badge,
    name: person?.name,
    check_time: checkTime,
    check_type: punchKind(rawType),
    check_type_raw: rawType || undefined,
    sensor_id: sensor || undefined,
    serial: serial || undefined,
    work_code: workCode && workCode !== "0" ? workCode : undefined,
  };
}

export function indexPeople(employees: ZktimeEmployee[]): Map<number, { badge: string; name: string }> {
  return new Map(employees.map((row) => [row.user_id, { badge: row.badge, name: row.name }]));
}

export function indexDepartments(rows: ZktimeDepartment[]): Map<number, string> {
  return new Map(rows.map((row) => [row.id, row.name]));
}

export function dateInRange(checkTime: string, from?: string, to?: string): boolean {
  const day = checkTime.slice(0, 10);
  if (from && day < from.slice(0, 10)) {
    return false;
  }
  if (to && day > to.slice(0, 10)) {
    return false;
  }
  return true;
}

export function matchesQuery(query: string | undefined, ...fields: Array<string | number | undefined>): boolean {
  if (!query) {
    return true;
  }
  const needle = query.trim().toLowerCase();
  return fields.some((field) => String(field ?? "").toLowerCase().includes(needle));
}
