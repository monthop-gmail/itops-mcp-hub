# Odoo MCP

เส้นบัญชีของ IT Operations Hub เมื่อไซต์ใช้ **Odoo** ไม่ใช่ Express หรือ Allinone: ยังเป็น **`/mcp/accounting/mcp`** คนละโทเคนกับ IT

**MTR ไม่ใช้ Odoo** — ปล่อย `ACCOUNTING_PRODUCT` เป็น express หรือ allinone  
**ICB ใช้แล้ว** และจะผลัก **NST** ให้ใช้ด้วย

พอร์ตเครื่องมือและบทเรียนจาก [cf-odoo-mcp-server](https://github.com/monthop-gmail/cf-odoo-mcp-server) (JSON-RPC `/jsonrpc`) มาเป็นคอนเทนเนอร์ในสแตกนี้ **ไม่ใช้ Cloudflare Worker** — ฮับมี Nginx Bearer + OAuth DCR อยู่แล้ว Worker เคยทำหน้าที่นั้นตอนเป็น endpoint เดี่ยวบนอินเทอร์เน็ต

| โหมด | ใช้เมื่อ | แบ็กเอนด์ |
| --- | --- | --- |
| ยังไม่ต่อ Odoo | kknang / MTR / ไซต์ที่ยังไม่เปิด | `ODOO_BACKEND=fixture` (ค่าเริ่ม) |
| Odoo ใน LAN | ICB Community ที่ลงเอง | `ODOO_BACKEND=jsonrpc` + `ODOO_URL=http://host.docker.internal:8069` |
| Odoo Online / SaaS | ถ้ารับจากไซต์ได้ | `ODOO_BACKEND=jsonrpc` + URL `https://….odoo.com` |

```
ACCOUNTING_PRODUCT=odoo
```

ฮับบัญชีโชว์ `odoo_*` หรือ `express_*` หรือ `allinone_*` ตามค่านี้ **ไม่ปนกัน**

ใช้ **API key ชนิด `rpc`** (ไม่ใช่ชนิด `mcp` ของ `/mcp` ในตัว Odoo 19 Enterprise) และ **อย่าใช้บัญชี admin**

## เครื่องมือ

อ่านอย่างเดียวเป็นค่าเริ่ม (`ODOO_ALLOW_WRITE=false`) ให้สอดคล้อง Express/Allinone

| Tool | ความหมาย |
| --- | --- |
| `odoo_get_status` | โหมด fixture / jsonrpc, รายชื่อเซิร์ฟเวอร์, `sample`, `allow_write` |
| `odoo_list_servers` | เซิร์ฟเวอร์ในคอนฟิก |
| `odoo_version` | เวอร์ชัน Odoo (ไม่ต้องล็อกอิน) |
| `odoo_context` | ผู้ใช้ บริษัท timezone ภาษา — datetime เป็น UTC |
| `odoo_get_models` | โมเดลที่ใช้ได้หลังรั้ว `BLOCKED_MODELS` |
| `odoo_fields_get` | นิยามฟิลด์ |
| `odoo_search_count` / `odoo_search_read` / `odoo_read` | ค้น/อ่าน (limit ค่าเริ่ม 50) |
| `odoo_read_group` | จัดกลุ่ม — ถ้าถูกตัดมี `has_more` + `total_records` |

เมื่อตั้ง `ODOO_ALLOW_WRITE=true` ทั้ง `sub-mcp-odoo` และ `mcp-hub-accounting` จึงโชว์ `odoo_create` / `odoo_write` / `odoo_delete` / `odoo_execute`  
`create`/`write` อ่านค่ากลับมาและใส่ `fields_not_applied` ถ้า Odoo ทิ้ง readonly เงียบ ๆ

## ICB (local)

```
ACCOUNTING_PRODUCT=odoo
ODOO_BACKEND=jsonrpc
ODOO_URL=http://host.docker.internal:8069
ODOO_DB=...
ODOO_USERNAME=mcp-bot@example.com
ODOO_PASSWORD=...          # API key ชนิด rpc ไม่ใช่รหัสผ่านแชท
ODOO_ALLOW_WRITE=false
ODOO_BLOCKED_MODELS=ir.*,res.users*,res.groups*
```

ต้องลงท้าย `*` — `res.users` อย่างเดียวจับไม่ถึง `res.users.apikeys`

```bash
docker compose up -d --build sub-mcp-odoo mcp-hub-accounting nginx
```

Odoo ใน LAN ไม่ต้องเปิดออกอินเทอร์เน็ต — คอนเทนเนอร์คุยในเครื่อง/VPN ได้ ต่างจาก Worker ตัวเดิมที่ต้องการ HTTPS สาธารณะ

หลายฐานในไซต์เดียวใช้ `ODOO_SERVERS` เป็น JSON แล้วเลือกด้วยอาร์กิวเมนต์ `server` ของเครื่องมือ

## สิ่งที่ไม่ทำในสแตกนี้

- ไม่ deploy `wrangler` / ไม่มี KV OAuth ของ Worker
- ไม่ชี้ไคลเอนต์ไป `/mcp` ในตัว Odoo (Enterprise อ่านอย่างเดียว และไม่มี OAuth สำหรับ ChatGPT/Grok)
- ไม่ dump ลูกค้าหรือยอดจริงใน collab — รายงานแค่ `count` / `backend` / `sample`

รายละเอียดพฤติกรรม Odoo 19 SaaS vs Community อยู่ที่ NOTES ของ repo ต้นทาง

## ตรวจ

```bash
npm run smoke -w @itops/mcp-odoo
```

บน ICB หลัง recreate: `odoo_get_status` ต้อง `ok: true` และ `sample: false`
