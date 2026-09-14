# Allinone Accounting MCP

เส้นบัญชีของ IT Operations Hub เมื่อไซต์ใช้ **Allinone** ไม่ใช่ Express: ยังเป็น **`/mcp/accounting/mcp`** คนละโทเคนกับ IT

โปรแกรมเป้าหมายคือ [Allinone Software](https://www.allinonesoft.com/) — **ไม่ใช่** Express ของ ESG และไม่ใช่ All-in-one ของต่างประเทศ

| รุ่น | ฐานข้อมูล | แบ็กเอนด์ในสแตกนี้ |
| --- | --- | --- |
| **Allinone VM** | Microsoft Access (`.mdb`) | `ALLINONE_BACKEND=mdb` |
| **Allinone CS** | MySQL | `ALLINONE_BACKEND=mysql` |
| ยังไม่มีสมุด | — | `ALLINONE_BACKEND=fixture` (ค่าเริ่ม) |

เลือกสินค้าบัญชีต่อไซต์ใน `.env`:

```
ACCOUNTING_PRODUCT=allinone
```

ค่าเริ่มคือ `express` — kknang ไม่ต้องเปลี่ยน ฮับบัญชีจะโชว์เครื่องมือ `allinone_*` หรือ `express_*` หรือ `odoo_*` ตาม `ACCOUNTING_PRODUCT` ไม่ปนกัน

ไม่มี REST สาธารณะ อ่านอย่างเดียว ไม่มี `run_shell`

## เครื่องมือ

| Tool | ความหมาย |
| --- | --- |
| `allinone_get_status` | โหมด `fixture` / `mdb` / `mysql`, รุ่น VM/CS, ชื่อกิจการ, `sample` |
| `allinone_inspect_schema` | รายชื่อตาราง + คอลัมน์ (ไม่มีข้อมูลแถว) |
| `allinone_list_customers` | ลูกหนี้ `ARMST` |
| `allinone_list_vendors` | เจ้าหนี้ `APMST` |
| `allinone_list_items` | สินค้า `INVMST` |
| `allinone_list_ar_invoices` | ใบแจ้งหนี้ `ARTR` (ค่าเริ่ม `open` = ยังมี `NBAL`) |
| `allinone_list_gl_accounts` | ผังบัญชี `GLMST` |

ทุกผลลัพธ์มี `sample: true` เมื่อเป็น fixture

ตารางและคอลัมน์จับจากชุดทดลอง Allinone VM (`DEMO.MDB`) ของผู้ขาย — CS ใช้ชื่อตารางชุดเดียวกันในรายงาน SQL (`ARMSQL` ฯลฯ)

## Allinone VM (Access)

บน Windows แฟ้มสมุดมักเป็น `.mdb` คู่กับ `CONFIG.MDB` (คอนฟิก ไม่ใช่สมุด)

```
ACCOUNTING_PRODUCT=allinone
ALLINONE_BACKEND=mdb
ALLINONE_HOST_DATA_DIR=/mnt/c/Allinone
# ALLINONE_MDB_FILE=DEMO.MDB   # ถ้าไม่ตั้ง จะหยิบ .mdb แรกที่ไม่ใช่ CONFIG.MDB
```

ใน WSL ชี้ไปโฟลเดอร์ที่มี `.mdb` แล้ว

```bash
docker compose up -d --build sub-mcp-allinone mcp-hub-accounting nginx
```

อิมเมจอ่านด้วย `mdb-json` (mdbtools) — ไม่ต้องมี Microsoft Access ในคอนเทนเนอร์  
`.accdb` รุ่นใหม่กว่า Jet อาจอ่านไม่ได้ ถ้าย้ายจาก VM เก่าให้ใช้ `.mdb`

ถ้าโปรแกรมเปิดแฟ้มอยู่ NTFS อาจล็อก — คัดลอก `.mdb` ไปโฟลเดอร์ snapshot แล้วชี้ `ALLINONE_HOST_DATA_DIR` ไปที่สำเนา

อย่า commit สมุดจริงหรือชุดทดลองของผู้ขายลง git

## Allinone CS (MySQL)

สร้างยูสเซอร์ MySQL **SELECT อย่างเดียว** แล้ว:

```
ACCOUNTING_PRODUCT=allinone
ALLINONE_BACKEND=mysql
ALLINONE_MYSQL_HOST=host.docker.internal
ALLINONE_MYSQL_PORT=3306
ALLINONE_MYSQL_USER=itops_ro
ALLINONE_MYSQL_PASSWORD=...
ALLINONE_MYSQL_DATABASE=allinone
```

บน Docker Desktop / WSL `host.docker.internal` ชี้เครื่อง Windows ที่รัน MySQL ของ CS  
อย่าใช้รูท MySQL และอย่าเปิดพอร์ต 3306 ออกอินเทอร์เน็ต

## ใบแจ้งหนี้

`ARTR.AMOUNT_D` = ยอดรวมภาษี, `NBAL` = ค้าง, `VOID` = ยกเลิก  
ข้ามเอกสารที่เลขที่ขึ้นต้น `RC` / `RE` (ใบเสร็จ)

รายงานกลับ collab / แชทสาธารณะแค่ `count` + `backend` / `sample` — ห้าม dump ลูกหนี้หรือยอด

## ตรวจ

```bash
ALLINONE_BACKEND=fixture npm run smoke -w @itops/mcp-allinone
```

บนไซต์หลัง recreate: `allinone_get_status` ต้อง `ok: true` และ `sample: false` เมื่อต่อสมุดจริง
