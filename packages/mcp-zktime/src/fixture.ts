import type { ZktimeStore, ZktimeStatus, ZktimeEmployee, ZktimeDepartment, ZktimeDevice, ZktimePunch, ZktimePunchQuery } from "./types.js";
import { dateInRange, matchesQuery } from "./map.js";

const NOTE =
  "ข้อมูลจำลองใน fixture — ZKTime 5 อ่าน att2000.mdb หรือ SQL Server ไม่คุยกับเครื่องสแกนโดยตรง. ต่อฐานจริงด้วย ZKTIME_BACKEND=mdb หรือ mssql";

const departments: ZktimeDepartment[] = [
  { id: 1, name: "สำนักงานใหญ่" },
  { id: 2, name: "ฝ่ายผลิต", parent_id: 1 },
];

const employees: ZktimeEmployee[] = [
  {
    user_id: 1,
    badge: "00001",
    name: "พนักงานตัวอย่าง ก",
    department_id: 1,
    department: "สำนักงานใหญ่",
    title: "ธุรการ",
    gender: "F",
    hired_on: "2020-03-01",
  },
  {
    user_id: 2,
    badge: "00002",
    name: "พนักงานตัวอย่าง ข",
    department_id: 2,
    department: "ฝ่ายผลิต",
    title: "ช่าง",
    gender: "M",
    hired_on: "2021-08-15",
  },
];

const devices: ZktimeDevice[] = [
  {
    id: 1,
    alias: "ประตูหน้า",
    ip: "192.168.1.201",
    port: 4370,
    enabled: true,
    serial: "DEMO0001",
    machine_number: 1,
    product_type: "F18",
    user_count: 2,
  },
];

const punches: ZktimePunch[] = [
  {
    user_id: 1,
    badge: "00001",
    name: "พนักงานตัวอย่าง ก",
    check_time: "2026-09-14 08:12:00",
    check_type: "in",
    check_type_raw: "I",
    sensor_id: "1",
  },
  {
    user_id: 1,
    badge: "00001",
    name: "พนักงานตัวอย่าง ก",
    check_time: "2026-09-14 17:05:00",
    check_type: "out",
    check_type_raw: "O",
    sensor_id: "1",
  },
  {
    user_id: 2,
    badge: "00002",
    name: "พนักงานตัวอย่าง ข",
    check_time: "2026-09-14 07:58:00",
    check_type: "in",
    check_type_raw: "I",
    sensor_id: "1",
  },
];

export class FixtureStore implements ZktimeStore {
  readonly kind = "fixture" as const;

  async inspect(): Promise<{ tables: string[]; columns: Record<string, string[]> }> {
    return {
      tables: ["USERINFO", "CHECKINOUT", "DEPARTMENTS", "Machines"],
      columns: {
        USERINFO: ["USERID", "Badgenumber", "Name", "DEFAULTDEPTID", "Gender", "TITLE", "CardNo", "HIREDDAY"],
        CHECKINOUT: ["USERID", "CHECKTIME", "CHECKTYPE", "VERIFYCODE", "SENSORID", "sn", "WorkCode"],
        DEPARTMENTS: ["DEPTID", "DEPTNAME", "SUPDEPTID"],
        Machines: ["ID", "MachineAlias", "IP", "Port", "Enabled", "sn"],
      },
    };
  }

  async status(): Promise<ZktimeStatus> {
    return {
      ok: true,
      product: "ZKTime",
      vendor: "https://www.zksoftwarecenter.com/",
      backend: "fixture",
      sample: true,
      site_name: "ไซต์ตัวอย่าง ZKTime",
      tables: ["USERINFO", "CHECKINOUT", "DEPARTMENTS", "Machines"],
      employee_count: employees.length,
      punch_count: punches.length,
      department_count: departments.length,
      device_count: devices.length,
      note: NOTE,
    };
  }

  async listEmployees(): Promise<ZktimeEmployee[]> {
    return employees;
  }

  async listDepartments(): Promise<ZktimeDepartment[]> {
    return departments;
  }

  async listDevices(): Promise<ZktimeDevice[]> {
    return devices;
  }

  async listPunches(opts: ZktimePunchQuery = {}): Promise<ZktimePunch[]> {
    return punches.filter((row) => {
      if (opts.user_id && row.user_id !== opts.user_id) {
        return false;
      }
      if (!dateInRange(row.check_time, opts.from, opts.to)) {
        return false;
      }
      return matchesQuery(opts.query, row.badge, row.name, row.user_id);
    });
  }
}
