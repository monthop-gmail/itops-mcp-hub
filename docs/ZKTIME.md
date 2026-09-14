# ZKTime 5 attendance MCP

เส้นเข้า-ออกงานของ IT Operations Hub บน **`/mcp/it/mcp`** และ **`/mcp/admin/mcp`** — **ไม่ใช่**สมุดบัญชี และไม่ใช่ Zabbix

โปรแกรมเป้าหมายคือ [ZKTeco ZKTime 5.0](https://www.zksoftwarecenter.com/download.html) (เครื่องสแกนนิ้ว / คำนวณเวลาทำงาน) — อ่านฐานของซอฟต์แวร์เท่านั้น **ไม่คุยกับเครื่องผ่าน SDK** (`zkemkeeper.dll`) ในรุ่นนี้

| โหมดซอฟต์แวร์ | ฐานข้อมูล | แบ็กเอนด์ในสแตกนี้ |
| --- | --- | --- |
| Access (ค่าที่พบบ่อย) | `att2000.mdb` | `ZKTIME_BACKEND=mdb` |
| SQL Server | ฐานที่สร้างจาก `sqlserver.SQL` | `ZKTIME_BACKEND=mssql` |
| ยังไม่มีฐาน | — | `ZKTIME_BACKEND=fixture` (ค่าเริ่ม) |

kknang ไม่ต้องเปลี่ยน — ค่าเริ่ม fixture ไม่กระทบไซต์ที่ยังไม่มี ZKTime  
MTR (หรือไซต์ที่มีเครื่องสแกน) ตั้ง `mdb` หรือ `mssql` แล้ว mount `att2000.mdb`

อ่านอย่างเดียว ไม่มี `run_shell` ไม่ดึงลายนิ้วมือ / ใบหน้า / SSN / รหัสผ่านพนักงาน / `CommPassword` ของเครื่อง

## เครื่องมือ

โชว์บนฮับ IT และ admin เท่านั้น

| Tool | ความหมาย |
| --- | --- |
| `zktime_get_status` | โหมด `fixture` / `mdb` / `mssql`, จำนวนพนักงาน/สแกน, `sample` |
| `zktime_inspect_schema` | รายชื่อตาราง + คอลัมน์ (ไม่มีข้อมูลแถว) |
| `zktime_list_employees` | พนักงาน `USERINFO` (รหัสบัตร/ชื่อ/แผนก) |
| `zktime_list_punches` | สแกน `CHECKINOUT` (`I`=in, `O`=out; กรอง `from`/`to`) |
| `zktime_list_departments` | แผนก `DEPARTMENTS` |
| `zktime_list_devices` | เครื่อง `Machines` (IP/พอร์ต/ซีเรียล — ไม่มีรหัสสื่อสาร) |

ทุกผลลัพธ์มี `sample: true` เมื่อเป็น fixture

ตารางจับจากชุดติดตั้ง Time 5 (`att2000.mdb` / `sqlserver.SQL`) ค่าเริ่มบนดิสก์ของผู้ขายมักเป็น `C:\Program Files\Att2007\att2000.mdb`

## Access (`att2000.mdb`)

บน Windows คัดลอกหรือแชร์โฟลเดอร์ที่มี `att2000.mdb` (ถ้าโปรแกรมเปิดแฟ้มอยู่ NTFS อาจล็อก — ใช้สำเนา snapshot)

```
ZKTIME_BACKEND=mdb
ZKTIME_HOST_DATA_DIR=/mnt/c/Att2007
# ZKTIME_MDB_FILE=att2000.mdb   # ถ้าไม่ตั้ง จะหยิบ att2000.mdb ถ้ามี ไม่งั้น .mdb แรกในโฟลเดอร์
```

```bash
docker compose up -d --build sub-mcp-zktime mcp-hub-it mcp-hub-admin nginx
```

อิมเมจอ่านด้วย `mdb-json` (mdbtools) — ไม่ต้องมี Microsoft Access ในคอนเทนเนอร์

อย่า commit ฐานจริงหรือชุดติดตั้ง `.rar` ของตัวแทนลง git

## SQL Server

สร้างล็อกอิน **SELECT อย่างเดียว** บนฐานที่ ZKTime ใช้ (มักชื่อ `att2000`) แล้ว:

```
ZKTIME_BACKEND=mssql
ZKTIME_MSSQL_HOST=host.docker.internal
ZKTIME_MSSQL_PORT=1433
ZKTIME_MSSQL_USER=itops_ro
ZKTIME_MSSQL_PASSWORD=...
ZKTIME_MSSQL_DATABASE=att2000
ZKTIME_MSSQL_ENCRYPT=false
```

บน Docker Desktop / WSL `host.docker.internal` ชี้เครื่อง Windows ที่รัน SQL Server ของ ZKTime  
อย่าใช้ `sa` ในโปรดักชัน และอย่าเปิดพอร์ต 1433 ออกอินเทอร์เน็ต  
SQL Server รุ่นเก่าของ ZKTime 5 มักต้อง `ZKTIME_MSSQL_ENCRYPT=false`

## สแกนเข้า-ออก

`CHECKINOUT.CHECKTYPE` ของชุดติดตั้งเป็น `I` / `O` — แมปเป็น `in` / `out`  
บางไซต์ใช้ `0`/`1` ก็แมปเหมือนกัน

รายงานกลับ collab / แชทสาธารณะแค่ `count` + `backend` / `sample` — ห้าม dump รายชื่อพนักงานหรือเวลาสแกนจริง

## ตรวจ

```bash
ZKTIME_BACKEND=fixture npm run smoke -w @itops/mcp-zktime
```

บนไซต์หลัง recreate: `zktime_get_status` ต้อง `ok: true` และ `sample: false` เมื่อต่อฐานจริง
