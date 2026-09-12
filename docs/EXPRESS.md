# Express Accounting MCP

เส้นบัญชีของ IT Operations Hub: **`/mcp/accounting/mcp`**

โปรแกรมเป้าหมายคือ [Express Accounting](https://express.co.th/) ของ ESG (ไทย) — **ไม่ใช่** InvoiceXpress / express-invoice APIs จากต่างประเทศ

## ข้อจำกัดของตัวโปรแกรม

Express Accounting บนเครื่องลูกค้าเก็บสมุดเป็น Visual FoxPro `.DBF` (เช่น ARMAS ลูกหนี้, APMAS เจ้าหนี้, STMAS สินค้า, GLMAS บัญชีแยกประเภท) และมี ODBC / ส่งออก Excel  
ESG **ไม่มี REST API สาธารณะ** สำหรับรุ่น desktop คลาวด์ V2 ก็ยังไม่มีเอกสารเปิด

ดังนั้น `sub-mcp-express` เป็นชั้นอ่านอย่างเดียวที่เลือกแบ็กเอนด์ได้ ไม่ได้เขียนกลับสมุด และไม่มี `run_shell`

## เครื่องมือ

| Tool | ความหมาย |
| --- | --- |
| `express_get_status` | โหมดที่ต่ออยู่ (`fixture` / `http` / `dbf`) ชื่อกิจการ และ `sample` |
| `express_list_customers` | ลูกหนี้ (ARMAS หรือ `GET /customers`) |
| `express_list_vendors` | เจ้าหนี้ (APMAS หรือ `GET /vendors`) |
| `express_list_items` | สินค้า (STMAS หรือ `GET /items`) |
| `express_list_ar_invoices` | ใบแจ้งหนี้ค้าง / ทั้งหมด — โหมด `dbf` ยังว่างจนกว่าจะมี adapter รายการขาย |
| `express_list_gl_accounts` | ผังบัญชี / ยอด (GLMAS หรือ `GET /gl-accounts`) |

ทุกผลลัพธ์มี `sample: true` เมื่อเป็นข้อมูลจำลอง

## แบ็กเอนด์

ตั้งใน `.env` แล้ว recreate `sub-mcp-express`

### `EXPRESS_BACKEND=fixture` (ค่าเริ่ม)

ข้อมูลตัวอย่างกิจการไทย ใช้ทดสอบคอนเนคเตอร์ ChatGPT/Grok ได้ทันทีโดยไม่ต้องมีสมุดจริง

### `EXPRESS_BACKEND=http`

ชี้ไปที่ REST ที่คุณทำเองบนเครื่องที่ติดตั้ง Express (Windows service, Access/ODBC bridge, หรือ Cloud V2 เมื่อมี)

```
EXPRESS_API_URL=http://express-bridge:8080
EXPRESS_API_TOKEN=...
```

สะพานต้องตอบ JSON เส้นอย่างน้อย:

- `GET /status` → `{ "company_name": "..." }`
- `GET /customers` → อาร์เรย์หรือ `{ "customers": [...] }`
- `GET /vendors`
- `GET /items`
- `GET /ar-invoices`
- `GET /gl-accounts`

ส่ง `Authorization: Bearer <EXPRESS_API_TOKEN>` ถ้าตั้งค่าไว้

### `EXPRESS_BACKEND=dbf`

Mount โฟลเดอร์ที่มี `.DBF` (อ่านอย่างเดียว) เข้าคอนเทนเนอร์ที่ `/data/express`

```
EXPRESS_BACKEND=dbf
EXPRESS_HOST_DATA_DIR=/mnt/c/ExpressI
EXPRESS_DBF_ENCODING=windows-874
EXPRESS_COMPANY_NAME=บริษัท ของฉัน จำกัด
```

**kknang (Windows + WSL):** สมุดอยู่ที่ `C:\ExpressI` = `/mnt/c/ExpressI` ใน Debian WSL. ใส่ค่านั้นใน `EXPRESS_HOST_DATA_DIR` แล้ว `docker compose` จะ bind-mount แบบ `:ro`

ก่อนขึ้นจริง:

```bash
ls /mnt/c/ExpressI | grep -iE 'ARMAS|APMAS|STMAS|GLMAS|\.dbf$'
```

ถ้า `.DBF` อยู่ในโฟลเดอร์ลูก (เช่น `DATA` หรือชื่อบริษัท) ให้ชี้ `EXPRESS_HOST_DATA_DIR` ไปที่โฟลเดอร์ที่มี `ARMAS.DBF` ไม่ใช่แค่รากโปรแกรม

ต้องมีอย่างน้อยหนึ่งใน `ARMAS.DBF`, `APMAS.DBF`, `STMAS.DBF` — `GLMAS.DBF` เป็นทางเลือก

ถ้า Express บน Windows กำลังเปิดแฟ้มอยู่ ไดรฟ์ NTFS อาจล็อก — คัดลอกชุด `.DBF` ไป `/var/lib/itops/express-snapshot` แล้วชี้ `EXPRESS_HOST_DATA_DIR` ไปที่สำเนา

## ความปลอดภัย

สมุดบัญชี **ไม่ใช่** งาน IT

- โทเคน: `ACCOUNTING_TOKEN` คนละค่ากับ `IT_TOKEN` / `ADMIN_TOKEN`
- Nginx: IT/admin ได้ 403 บน `/mcp/accounting/` และโทเคนบัญชีได้ 403 บน `/mcp/it/` กับ `/mcp/admin/`
- OAuth scope: `mcp:accounting`
- ทีมบัญชีเชื่อม `https://<hostname>/mcp/accounting/mcp` แบบ OAuth แล้ววาง `ACCOUNTING_TOKEN` บน `/authorize`
- ห้ามส่ง `ACCOUNTING_TOKEN` ใน collab / README / แชทกลุ่ม

ดูขั้นตอนคอนเนคเตอร์ที่ [TEAM-CONNECT.md](TEAM-CONNECT.md)
