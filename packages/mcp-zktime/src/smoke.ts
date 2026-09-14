import { asDateTime, employeeFromUserinfo, punchFromRow, punchKind } from "./map.js";
import { createZktimeStore } from "./store.js";
import { MdbStore } from "./mdb-store.js";

async function main(): Promise<void> {
  process.env.ZKTIME_BACKEND = "fixture";
  const store = createZktimeStore();
  const status = await store.status();
  if (!status.sample || (status.employee_count ?? 0) < 1 || (status.punch_count ?? 0) < 1) {
    throw new Error("fixture attendance incomplete");
  }

  if (punchKind("I") !== "in" || punchKind("O") !== "out" || punchKind("0") !== "in" || punchKind("1") !== "out") {
    throw new Error("CHECKTYPE mapping failed");
  }

  const person = employeeFromUserinfo(
    {
      USERID: 9,
      Badgenumber: "00009",
      Name: "ทดสอบ",
      DEFAULTDEPTID: 1,
      TITLE: "ธุรการ",
      Gender: "F",
      CardNo: "AB12",
      HIREDDAY: "03/01/20 00:00:00",
      SSN: "must-not-appear",
      PASSWORD: "secret",
    },
    new Map([[1, "สำนักงานใหญ่"]]),
  );
  if (
    !person ||
    person.badge !== "00009" ||
    person.department !== "สำนักงานใหญ่" ||
    person.hired_on !== "2020-03-01" ||
    "ssn" in person ||
    "password" in person
  ) {
    throw new Error(`USERINFO mapping failed: ${JSON.stringify(person)}`);
  }

  const punch = punchFromRow(
    { USERID: 9, CHECKTIME: "12/08/14 08:30:00", CHECKTYPE: "I", SENSORID: "1", WorkCode: "0" },
    new Map([[9, { badge: "00009", name: "ทดสอบ" }]]),
  );
  if (
    !punch ||
    punch.check_type !== "in" ||
    punch.check_time !== "2014-12-08 08:30:00" ||
    punch.badge !== "00009" ||
    punch.work_code
  ) {
    throw new Error(`CHECKINOUT mapping failed: ${JSON.stringify(punch)}`);
  }

  if (asDateTime("2014-12-07 15:48:16") !== "2014-12-07 15:48:16") {
    throw new Error(`datetime parse failed: ${asDateTime("2014-12-07 15:48:16")}`);
  }

  const ins = (await store.listPunches()).filter((row) => row.check_type === "in").length;
  const outs = (await store.listPunches()).filter((row) => row.check_type === "out").length;
  if (ins < 1 || outs < 1) {
    throw new Error(`fixture punch split failed in=${ins} out=${outs}`);
  }

  const demoPath = process.env.ZKTIME_SMOKE_MDB;
  if (demoPath) {
    const dir = demoPath.slice(0, demoPath.lastIndexOf("/"));
    const file = demoPath.slice(demoPath.lastIndexOf("/") + 1);
    const live = new MdbStore(dir, file, "");
    const liveStatus = await live.status();
    if (liveStatus.sample || liveStatus.backend !== "mdb") {
      throw new Error(`expected live mdb attendance: ${JSON.stringify(liveStatus)}`);
    }
    if ((liveStatus.employee_count ?? 0) < 1 || (liveStatus.punch_count ?? 0) < 1) {
      throw new Error(
        `demo mdb incomplete employees=${liveStatus.employee_count} punches=${liveStatus.punch_count}`,
      );
    }
    const punches = await live.listPunches();
    const liveIn = punches.filter((row) => row.check_type === "in").length;
    const liveOut = punches.filter((row) => row.check_type === "out").length;
    if (liveIn < 1 || liveOut < 1) {
      throw new Error(`demo CHECKINOUT status split failed in=${liveIn} out=${liveOut}`);
    }
    const devices = await live.listDevices();
    if (devices.some((row) => "comm_password" in row || "CommPassword" in row)) {
      throw new Error("CommPassword leaked from Machines");
    }
    const schema = await live.inspect();
    if (!schema.tables.some((name) => name.toLowerCase() === "userinfo")) {
      throw new Error("inspect missing USERINFO");
    }
    console.log(
      "zktime mdb smoke ok",
      "employees",
      liveStatus.employee_count,
      "punches",
      liveStatus.punch_count,
      "devices",
      devices.length,
    );
  }

  console.log("zktime fixture smoke ok", status.site_name, status.employee_count);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
