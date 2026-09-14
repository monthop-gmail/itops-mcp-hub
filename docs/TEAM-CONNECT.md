# ทีมทดลอง MCP บน ChatGPT / Grok (read-only)

ใช้เอกสารนี้ตอนส่งให้ทีมลองคุยกับ Zabbix / MeshCentral / ZKTime / pstack / สมุดบัญชี (Express / Allinone / Odoo) / คลังเอกสาร ผ่าน AI **ระหว่างรอ ai-tools-mcp** (ชั้นอนุมัติคำสั่ง privileged)

สรุปสั้น: **ลองได้** ถ้าต่อเส้นที่ตรงบทบาท (`/mcp/it/` หรือ `/mcp/accounting/`) และมี URL แบบ HTTPS ที่อินเทอร์เน็ตถึงได้  
ยัง **ห้าม** ส่ง `ADMIN_TOKEN` หรือเปิด `meshcentral_run_shell`

งาน IT กับสมุดบัญชี **คนละโทเคน คนละ URL** — ดู [EXPRESS.md](EXPRESS.md) [ALLINONE.md](ALLINONE.md) หรือ [ODOO.md](ODOO.md)

## สิ่งที่ทีมจะเห็น

เครื่องมือบน hub IT:

| Tool | ใช้ถามอะไร |
| --- | --- |
| `zabbix_get_active_problems` | ปัญหาที่ยังไม่ปิด (optional `severity_min`) |
| `zabbix_get_device_status` | สถานะโฮสต์ในกลุ่มที่ระบุ |
| `zabbix_get_metrics` | ค่า item ของโฮสต์ |
| `meshcentral_get_inventory` | รายการเครื่องใน MeshCentral |
| `zktime_get_status` / `zktime_list_punches` | เข้า-ออกงาน ZKTime 5 (fixture จนกว่าไซต์จะต่อ `att2000.mdb`) |
| `pstack_list_tools` / `pstack_call_tool` | เครื่องมือของอินสแตนซ์ pstack (ไม่ใช่เอเจนต์ในตัว) |
| `rag_search` / `rag_list_sources` | เอกสารงบ/ราชการของไซต์ (path คือโครงสร้าง) |
| `rag_list_ocr_queue` / `rag_review_ocr_job` | คิวหน้าสแกนว่าง — ต้อง approve ก่อนส่งข้อความ/ภาพ |
| `rag_run_ocr` | ส่งหน้าที่ approve แล้วไป Typhoon (หรือค่ายที่ตั้ง) ทีละหน้า |

ถ้า AI เห็น `meshcentral_run_shell` แปลว่าต่อผิดเส้น — ถอดออกทันที

ทีมบัญชีเห็น `express_*` หรือ `allinone_*` หรือ `odoo_*` (ตาม `ACCOUNTING_PRODUCT` ของไซต์) บวกชุด `rag_*` เดียวกันบน `/mcp/accounting/mcp` ไม่เห็น Zabbix/MeshCentral
เอกสาร RAG ดู [RAG.md](RAG.md)  
เข้า-ออกงาน ZKTime ดู [ZKTIME.md](ZKTIME.md) — รายงานสาธารณะแค่จำนวนแถว ห้าม dump รายชื่อพนักงาน  
pstack ดู [PSTACK.md](PSTACK.md)

## สิ่งที่ยังใช้ไม่ได้จนกว่าจะมี tunnel

ChatGPT และ Grok.com ยิงจากคลาวด์ของเขา ไม่ใช่จากเครื่องคนในทีม  
`http://127.0.0.1:9080` หรือ IP ใน LAN ของไซต์ **จะต่อไม่ติด**

ต้องมีอย่างใดอย่างหนึ่ง:

1. **Cloudflare Tunnel** ไปที่ Nginx ของไซต์นั้น (แนะนำ) — ดู README ส่วน Cloudflare Tunnel
2. หรือ VPN เข้า LAN ของไซต์ แล้วใช้ไคลเอนต์ที่รันบนเครื่องใน VPN (Cursor / Grok desktop) ไม่ใช่ ChatGPT บนเว็บ

ช่วงทดลองกับ ChatGPT / Grok.com / Gemini:

ตรวจก่อนว่า OAuth ขึ้นแล้ว: เปิด `https://<hostname>/.well-known/oauth-authorization-server` ต้องได้ JSON ไม่ใช่ 404 `OAuth metadata is disabled`

ถ้ายัง 404 บนโฮสต์ไซต์:

```bash
git pull
# ใน .env ต้องมี
# PUBLIC_MCP_ORIGIN=https://mcp-kknang.sumana.org
docker compose up -d --build mcp-oauth nginx
```

ช่วงทดลองกับคอนเนคเตอร์บนเว็บ อย่าบังคับ Cloudflare Access (ChatGPT/Grok/Gemini ส่ง extra CF-Access header ไม่ได้)

เมื่ออยากใส่ Access อีกชั้น ให้ใช้ Cursor / Claude Desktop / Grok CLI ที่ตั้ง header เพิ่มได้ ไม่ใช่ ChatGPT web

## ส่งให้ทีมอะไรบ้าง

ส่งในแชทส่วนตัวหรือ password manager **ห้าม commit ลง git / ห้ามโพสต์ใน collab MCP**

```
ไซต์: kknang          (อย่าใช้ token นี้กับ ICB / MTR / NST)
MCP URL: https://<hostname>/mcp/it/mcp
บทบาท: IT read-only
วิธีใส่โทเคน: เชื่อมด้วย OAuth แล้ววาง IT_TOKEN บนหน้าเว็บ /authorize
อย่าใช้: /mcp/admin/ และ ADMIN_TOKEN
```

สำหรับบัญชี (Express / Allinone / Odoo — URL เดียวกัน):

```
MCP URL: https://<hostname>/mcp/accounting/mcp
บทบาท: accounting read-only
วิธีใส่โทเคน: OAuth แล้ววาง ACCOUNTING_TOKEN
scope: mcp:accounting
อย่าใช้: IT_TOKEN / ADMIN_TOKEN / /mcp/it/ / /mcp/admin/
```

แต่ละไซต์มี token ของตัวเอง อย่าคัดลอกของ kknang ไปไซต์อื่น

## ChatGPT (เว็บ / Apps)

ต้องมีแพ็กที่เปิด custom MCP connector ได้ (Plus / Pro / Business / Enterprise / Edu ตามที่ OpenAI เปิด Developer Mode)

1. โปรไฟล์ → **Settings** → **Apps & Connectors** → เปิด **Developer Mode**
2. **Create** คอนเนคเตอร์ใหม่
3. ใส่ค่าประมาณนี้:

| ช่อง | ค่า |
| --- | --- |
| Name | `itops-kknang-it` (หรือชื่อไซต์จริง) |
| Connector URL | `https://<hostname>/mcp/it/mcp` |
| Authentication | **OAuth** (อย่าเลือก Token) |

ใช้ **Streamable HTTP** ที่ลงท้าย `/mcp` ไม่ใช่ `/sse`

ครั้งแรก ChatGPT จะเปิดเบราว์เซอร์ไปที่ `https://<hostname>/authorize` — วาง **IT_TOKEN** แล้วกดอนุญาต เหมือนตอนเชื่อม `ai-collaboration-mcp`

ถ้าเลือก Token ใน ChatGPT แล้วยังไม่มีช่องวางเฮดเดอร์: สลับเป็น OAuth แล้วใช้หน้าเว็บของเรา

หลังต่อแล้วลองถาม:

- มีปัญหาอะไรเปิดอยู่ใน Zabbix ตอนนี้
- โฮสต์ในกลุ่ม KKNANG สถานะเป็นอย่างไร
- MeshCentral เห็นเครื่องอะไรบ้าง

## Grok

### grok.com (custom connector)

Grok เว็บไม่ใช้ DCR — ต้องวางค่าแอป OAuth เอง. หลังเกตเวย์มี OAuth แล้วเปิด `https://<hostname>/oauth/setup` หรือวาง:

| ช่อง | ค่า |
| --- | --- |
| MCP URL | `https://<hostname>/mcp/it/mcp` |
| Client ID | `itops-public` |
| Client Secret | `itops-public-secret` (ว่างได้) |
| Authorization Endpoint | `https://<hostname>/authorize` |
| Token Endpoint | `https://<hostname>/token` |
| Scopes | `mcp:it` (พิมพ์แล้วกด Enter) |
| Token Auth Method | none (PKCE only) |

จากนั้น Grok จะเปิดหน้าเว็บของเราให้วาง `IT_TOKEN`

1. ไปที่ [grok.com/connectors](https://grok.com/connectors)
2. **New Connector** → **Custom**
3. ใส่ตารางด้านบน — อย่าเดา Client ID เอง
4. เซิร์ฟเวอร์ต้องเข้าถึงจากอินเทอร์เน็ตได้ (tunnel)

องค์กร Grok Business/Enterprise อาจต้องให้แอดมินโปรวิชันคอนเนคเตอร์ก่อนสมาชิกใช้

### Grok desktop / CLI (ง่ายกว่าเว็บ)

```bash
grok mcp add --transport http itops-kknang-it \
  https://<hostname>/mcp/it/mcp \
  --header "Authorization: Bearer ${IT_TOKEN}"
```

หรือใน `~/.grok/config.toml`:

```toml
[mcp_servers.itops-kknang-it]
url = "https://<hostname>/mcp/it/mcp"
headers = { Authorization = "Bearer ${IT_TOKEN}" }
enabled = true
```

ถ้ายังอยู่บน LAN (ไม่มี tunnel) และ Grok รันบนเครื่องในไซต์:

```toml
[mcp_servers.itops-kknang-it]
url = "http://127.0.0.1:9080/mcp/it/mcp"
headers = { Authorization = "Bearer ${IT_TOKEN}" }
enabled = true
```

## Cursor / Claude Desktop

ยังเป็นไคลเอนต์ที่เสถียรที่สุดตอนทดลอง LAN

Cursor `.cursor/mcp.json` หรือ Claude ที่รองรับ URL + headers:

```json
{
  "mcpServers": {
    "itops-kknang-it": {
      "url": "https://<hostname>/mcp/it/mcp",
      "headers": {
        "Authorization": "Bearer IT_TOKEN_HERE"
      }
    }
  }
}
```

Claude Desktop รุ่นที่พูด SSE อย่างเดียวให้ใช้ `/mcp/it/sse` ผ่าน `mcp-remote` ตาม README

## Gemini

Gemini ปฏิเสธ Bearer อย่างเดียว — ต้องเป็น OAuth 2.0 มาตรฐาน. หลังเกตเวย์มี discovery แล้ว:

| ช่อง | ค่า |
| --- | --- |
| MCP Server URL | `https://<hostname>/mcp/it/mcp` |
| Authentication | OAuth 2.0 |
| Authorization URL | `https://<hostname>/authorize` |
| Token URL | `https://<hostname>/token` |
| Client ID | `itops-public` |
| Client Secret | `itops-public-secret` |
| Scopes | `mcp:it` |
| PKCE | เปิดถ้ามีช่อง |

ครั้งแรกจะเด้งหน้าให้วาง `IT_TOKEN` เหมือน Grok

## สิ่งที่อย่าทำตอนทดลอง

- อย่าส่ง `ADMIN_TOKEN`
- อย่าชี้คอนเนคเตอร์ไป `/mcp/admin/`
- อย่าเปิด `meshcentral_run_shell` — รอสัญญา approval + คิวคน + audit จาก ai-tools-mcp
- อย่าเปิด Zabbix UI (`:9443`) หรือ MeshCentral (`:9444`) ออกอินเทอร์เน็ต เปิดเฉพาะ MCP gateway
- อย่าใส่ token ใน URL (`?api_key=`) — โผล่ในล็อกพร็อกซี
- อย่าใช้ `IT_TOKEN` กับ `/mcp/accounting/` และอย่าใช้ `ACCOUNTING_TOKEN` กับเส้น IT
- ถ้า ChatGPT บอกว่า `itops-mcp-hub-accounting:` tools ไม่มีในเทิร์นนี้ — คอนเนคเตอร์หลุดเซสชัน (มักหลังยิงคิวรียาว) ให้ปิด/เปิด MCP แล้ว initialize ใหม่ ไม่ใช่หลักฐานว่าคลังเอกสารหาย
- ค่าเริ่มสมุดบัญชีเป็นข้อมูล **fixture** (`sample: true`) จนกว่าไซต์จะต่อ Express DBF/HTTP, Allinone .mdb/MySQL หรือ Odoo `/jsonrpc`
- ค่าเริ่ม ZKTime เป็น **fixture** จนกว่าไซต์จะต่อ `att2000.mdb` หรือ SQL Server

## เมื่อไหร่ต้องรอ ai-tools-mcp

| อยากทำ | ทำตอนนี้ได้ไหม |
| --- | --- |
| อ่านปัญหา / สถานะเครื่อง / inventory | ได้ หลังมี HTTPS + IT token |
| ให้ทีม ChatGPT / Grok ช่วยดูไซต์ | ได้ บนเส้น IT |
| อ่านลูกหนี้ / สินค้า / GL / ใบแจ้งหนี้ | ได้ บน `/mcp/accounting/mcp` (Express / Allinone / Odoo ตามไซต์) |
| อ่านเข้า-ออกงาน ZKTime | ได้ บน `/mcp/it/mcp` (`zktime_*`, อ่านอย่างเดียว) |
| สั่งคำสั่งบนเครื่องผ่าน MeshCentral | ยังไม่ได้ — รอ approval |
| ลงรายการขายหรือแก้ไขสมุด | ไม่มีใน MCP นี้ — อ่านอย่างเดียว |

`ai-collaboration-mcp` เป็นที่คุยงานของเอเจนต์ ไม่ใช่รันไทม์เครื่องมือ IT
