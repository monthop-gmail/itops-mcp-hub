# ทีมทดลอง MCP บน ChatGPT / Grok (read-only)

ใช้เอกสารนี้ตอนส่งให้ทีมลองคุยกับ Zabbix / MeshCentral ผ่าน AI **ระหว่างรอ ai-tools-mcp** (ชั้นอนุมัติคำสั่ง privileged)

สรุปสั้น: **ลองได้** ถ้าต่อเส้น IT อย่างเดียว (`/mcp/it/`) และมี URL แบบ HTTPS ที่อินเทอร์เน็ตถึงได้  
ยัง **ห้าม** ส่ง `ADMIN_TOKEN` หรือเปิด `meshcentral_run_shell`

## สิ่งที่ทีมจะเห็น

เครื่องมือ 4 ตัวบน hub IT:

| Tool | ใช้ถามอะไร |
| --- | --- |
| `zabbix_get_active_problems` | ปัญหาที่ยังไม่ปิด (optional `severity_min`) |
| `zabbix_get_device_status` | สถานะโฮสต์ในกลุ่มที่ระบุ |
| `zabbix_get_metrics` | ค่า item ของโฮสต์ |
| `meshcentral_get_inventory` | รายการเครื่องใน MeshCentral |

ถ้า AI เห็นเครื่องมือที่ 5 (`meshcentral_run_shell`) แปลว่าต่อผิดเส้น — ถอดออกทันที

## สิ่งที่ยังใช้ไม่ได้จนกว่าจะมี tunnel

ChatGPT และ Grok.com ยิงจากคลาวด์ของเขา ไม่ใช่จากเครื่องคนในทีม  
`http://127.0.0.1:9080` หรือ IP ใน LAN ของไซต์ **จะต่อไม่ติด**

ต้องมีอย่างใดอย่างหนึ่ง:

1. **Cloudflare Tunnel** ไปที่ Nginx ของไซต์นั้น (แนะนำ) — ดู README ส่วน Cloudflare Tunnel
2. หรือ VPN เข้า LAN ของไซต์ แล้วใช้ไคลเอนต์ที่รันบนเครื่องใน VPN (Cursor / Grok desktop) ไม่ใช่ ChatGPT บนเว็บ

ช่วงทดลองกับ ChatGPT / Grok.com:

- เปิด tunnel ให้ hostname สาธารณะชี้ `http://nginx:80`
- **อย่าใส่ Cloudflare Access** บังคับ `CF-Access-Client-Id` / `CF-Access-Client-Secret` — คอนเนคเตอร์บนเว็บส่วนใหญ่ส่งได้แค่ `Authorization`
- อาศัย Nginx Bearer (`IT_TOKEN`) เป็นตัวล็อก
- แชร์เฉพาะ `IT_TOKEN` ของไซต์นั้น หมุนทิ้งหลังทดลอง

เมื่ออยากใส่ Access อีกชั้น ให้ใช้ Cursor / Claude Desktop / Grok CLI ที่ตั้ง header เพิ่มได้ ไม่ใช่ ChatGPT web

## ส่งให้ทีมอะไรบ้าง

ส่งในแชทส่วนตัวหรือ password manager **ห้าม commit ลง git / ห้ามโพสต์ใน collab MCP**

```
ไซต์: kknang          (อย่าใช้ token นี้กับ ICB / MTR / NST)
MCP URL: https://<hostname>/mcp/it/mcp
บทบาท: IT read-only
Authorization: Bearer <IT_TOKEN>
อย่าใช้: /mcp/admin/ และ ADMIN_TOKEN
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
| Authentication | **Token** แล้ววาง `IT_TOKEN` (ChatGPT จะใส่เป็น `Authorization: Bearer …`) |

ใช้ **Streamable HTTP** ที่ลงท้าย `/mcp` ไม่ใช่ `/sse`

ถ้า UI ไม่มี Token มีแต่ OAuth: ChatGPT เวอร์ชันนั้นยังต่อสแตกนี้ไม่ได้โดยตรง (สแตกส่ง Bearer คงที่ ยังไม่มี OAuth 2.1) — ให้ทีมลอง **Grok desktop / Cursor** แทน อย่าเปิด admin เพื่อเลี่ยงปัญหา auth

หลังต่อแล้วลองถาม:

- มีปัญหาอะไรเปิดอยู่ใน Zabbix ตอนนี้
- โฮสต์ในกลุ่ม KKNANG สถานะเป็นอย่างไร
- MeshCentral เห็นเครื่องอะไรบ้าง

## Grok

### grok.com (custom connector)

1. ไปที่ [grok.com/connectors](https://grok.com/connectors)
2. **New Connector** → **Custom**
3. URL: `https://<hostname>/mcp/it/mcp`
4. Auth: Bearer / Token = `IT_TOKEN` ถ้ามีช่องให้ใส่
5. เซิร์ฟเวอร์ต้องเข้าถึงจากอินเทอร์เน็ตได้ (tunnel)

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

## สิ่งที่อย่าทำตอนทดลอง

- อย่าส่ง `ADMIN_TOKEN`
- อย่าชี้คอนเนคเตอร์ไป `/mcp/admin/`
- อย่าเปิด `meshcentral_run_shell` — รอสัญญา approval + คิวคน + audit จาก ai-tools-mcp
- อย่าเปิด Zabbix UI (`:9443`) หรือ MeshCentral (`:9444`) ออกอินเทอร์เน็ต เปิดเฉพาะ MCP gateway
- อย่าใส่ token ใน URL (`?api_key=`) — โผล่ในล็อกพร็อกซี

## เมื่อไหร่ต้องรอ ai-tools-mcp

| อยากทำ | ทำตอนนี้ได้ไหม |
| --- | --- |
| อ่านปัญหา / สถานะเครื่อง / inventory | ได้ หลังมี HTTPS + IT token |
| ให้ทีม ChatGPT / Grok ช่วยดูไซต์ | ได้ บนเส้น IT |
| สั่งคำสั่งบนเครื่องผ่าน MeshCentral | ยังไม่ได้ — รอ approval |

`ai-collaboration-mcp` เป็นที่คุยงานของเอเจนต์ ไม่ใช่รันไทม์เครื่องมือ IT
