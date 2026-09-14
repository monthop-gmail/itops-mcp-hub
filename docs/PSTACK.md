# pstack MCP bridge

ฮับ IT/admin ต่อ **อินสแตนซ์ pstack ที่รันอยู่แล้ว** ไม่ได้ฝังแพลตฟอร์มลง Docker Compose นี้

[pstack](https://github.com/willpower-institute/pstack) เป็น BaaS / Dev Framework (FastAPI + addon สไตล์ Odoo) มี AI agent ในตัว **และ** มี `POST /mcp` เปิด tool registry ให้ AI ภายนอกอยู่แล้ว — กรองตาม RBAC ของเจ้าของ API key (`psk_...`)

โจทย์ของฮับนี้คือให้ ChatGPT / Grok / Cursor บน `/mcp/it/mcp` **เรียกเครื่องมือของ pstack ได้** โดยไม่ต้องคุยผ่านเอเจนต์ Claude ใน pstack (ไม่ซ้อน agent)

| | ฮับนี้ทำ | ไม่ทำ |
| --- | --- | --- |
| ต่อ MCP | JSON-RPC `POST /mcp` แบบที่ pstack implement แล้ว | ไม่ใช้ Cloudflare Worker, ไม่ session SSE |
| เครื่องมือ | `pstack_list_tools` + `pstack_call_tool` — โมดูลใหม่โผล่เอง | ไม่ hardcode ชื่อ tool ทุกตัว |
| เอเจนต์ | — | ไม่ห่อ `POST /api/agent/sessions` |
| สิทธิ์ | รั้วที่สอง `PSTACK_ALLOWED_TOOLS` / `PSTACK_BLOCKED_TOOLS` | รั้วหลักอยู่ที่ user เจ้าของ key บน pstack |

ค่าเริ่ม `PSTACK_BACKEND=fixture` — ไซต์ที่ยังไม่มี pstack (เช่น MTR) ไม่ต้องตั้งอะไร

## เครื่องมือบนฮับ IT / admin

| Tool | ความหมาย |
| --- | --- |
| `pstack_get_status` | `healthz` + `initialize`, จำนวน tool, `sample` |
| `pstack_list_tools` | `tools/list` จาก pstack (กรอง RBAC แล้ว) |
| `pstack_call_tool` | `tools/call` ส่ง `arguments` ตาม schema ของ tool นั้น; `tenant_id` → `X-Tenant-Id` |

## ต่ออินสแตนซ์จริง

1. บน pstack สร้างผู้ใช้เฉพาะงาน IT (อย่าใช้ admin) แล้ว `POST /api/keys {"name":"itops-hub"}` ได้ `psk_...` ครั้งเดียว
2. ใน `.env` ของฮับ:

```
PSTACK_BACKEND=http
PSTACK_URL=http://host.docker.internal:8000
# หรือ https://<โดเมน pstack ของโปรเจกต์>
PSTACK_API_KEY=psk_...
# PSTACK_TENANT_ID=acme          # ค่าเริ่ม X-Tenant-Id ถ้าใช้ multi-tenant
# PSTACK_ALLOWED_TOOLS=search_faq,count_users
```

```bash
docker compose up -d --build sub-mcp-pstack mcp-hub-it mcp-hub-admin nginx
```

อย่า commit `psk_` ลง git  
อย่า dump ผล `search_users` / ข้อมูลลูกค้าใน collab — รายงานแค่ `count` / `backend` / ชื่อ tool

หลายโปรเจกต์ pstack (vidhisa, thudong, co-train) = คนละ URL/คนละ key ต่อไซต์หรือต่อสแตก ไม่ใช่รวมในคอนเทนเนอร์เดียว

## ตรวจ

```bash
npm run smoke -w @itops/mcp-pstack
```

เมื่อต่อจริง: `pstack_get_status` ต้อง `ok: true` และ `sample: false`
