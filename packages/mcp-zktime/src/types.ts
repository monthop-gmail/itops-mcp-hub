export type ZktimeBackendKind = "fixture" | "mdb" | "mssql";
export type PunchKind = "in" | "out" | "unknown";

export interface ZktimeStatus {
  ok: boolean;
  product: "ZKTime";
  vendor: "https://www.zksoftwarecenter.com/";
  backend: ZktimeBackendKind;
  sample: boolean;
  site_name?: string;
  source?: string;
  tables?: string[];
  employee_count?: number;
  punch_count?: number;
  department_count?: number;
  device_count?: number;
  note: string;
}

export interface ZktimeEmployee {
  user_id: number;
  badge: string;
  name: string;
  department_id?: number;
  department?: string;
  title?: string;
  gender?: string;
  card_no?: string;
  hired_on?: string;
}

export interface ZktimeDepartment {
  id: number;
  name: string;
  parent_id?: number;
}

export interface ZktimeDevice {
  id: number;
  alias: string;
  ip?: string;
  port?: number;
  enabled?: boolean;
  serial?: string;
  machine_number?: number;
  product_type?: string;
  firmware?: string;
  user_count?: number;
}

export interface ZktimePunch {
  user_id: number;
  badge?: string;
  name?: string;
  check_time: string;
  check_type: PunchKind;
  check_type_raw?: string;
  sensor_id?: string;
  serial?: string;
  work_code?: string;
}

export interface ZktimePunchQuery {
  from?: string;
  to?: string;
  query?: string;
  user_id?: number;
}

export interface ZktimeStore {
  kind: ZktimeBackendKind;
  status(): Promise<ZktimeStatus>;
  inspect?(): Promise<{ tables: string[]; columns: Record<string, string[]> }>;
  listEmployees(): Promise<ZktimeEmployee[]>;
  listDepartments(): Promise<ZktimeDepartment[]>;
  listDevices(): Promise<ZktimeDevice[]>;
  listPunches(opts?: ZktimePunchQuery): Promise<ZktimePunch[]>;
}

export type ZktimeRow = Record<string, unknown>;
