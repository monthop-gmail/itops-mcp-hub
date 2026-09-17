# Host file MCP — ศึกษา Desktop Commander แล้วจะทำอย่างไรในฮับนี้

สถานะ: **ศึกษาแล้ว ยังไม่ลงโค้ด**  
ต้นทางที่ดู: [wonderwhy-er/DesktopCommanderMCP](https://github.com/wonderwhy-er/DesktopCommanderMCP) (MIT, npm `@wonderwhy-er/desktop-commander`)  
กระทู้: `dis-58a707ef` seq 60–61

ฮับนี้ไม่ใช่ desktop ของคนนั่งเครื่องเดียว มันคือ Docker Compose ที่เปิด `/mcp/admin` ออกอินเทอร์เน็ตผ่าน Cloudflare Tunnel  
จึง **ไม่นำแพ็กเกจต้นทางมาฝัง** และไม่เปิดเชลล์บนโฮสต์จนกว่า `meshcentral_run_shell` จะมีชั้นอนุมัติเดียวกัน

## Desktop Commander คืออะไร

MCP ที่ให้ AI (Claude Desktop, ChatGPT, Cursor, …) ทำงานบนเครื่องที่รันเซิร์ฟเวอร์:

| กลุ่ม | เครื่องมือ | ความหมาย |
| --- | --- | --- |
| Config | `get_config`, `set_config_value` | อ่าน/เขียน `allowedDirectories`, `blockedCommands`, `defaultShell`, telemetry, ลิมิตอ่าน-เขียน |
| Terminal | `start_process`, `interact_with_process`, `read_process_output`, `list_sessions`, `force_terminate`, `list_processes`, `kill_process` | เซสชันเชลล์ยาว, ส่งอินพุต, ฆ่าโปรเซส |
| Filesystem | `read_file`, `read_multiple_files`, `write_file`, `write_pdf`, `list_directory`, `create_directory`, `move_file`, `start_search` / `get_more_search_results`, `get_file_info` | อ่าน-เขียนไฟล์ รวม Excel / PDF / DOCX, ค้นแบบสตรีม, ดึง URL ได้ |
| Edit | `edit_block` | แทนที่ข้อความแบบ SEARCH/REPLACE |
| Analytics | `get_usage_stats`, `get_recent_tool_calls`, `give_feedback_to_desktop_commander` | สถิติ + ประวัติเรียกเครื่อง + ฟอร์ม feedback |

จุดขายของเขาคือ **เครื่องที่คุณนั่งอยู่** เป็น sandbox ของงานเขียนโค้ด / วิเคราะห์ CSV / SSH ออกไปเครื่องอื่น  
เขามี Remote MCP ที่ `mcp.desktopcommander.app` ด้วย — โมเดลเดียวกับที่ฮับเราเปิด tunnel สาธารณะอยู่แล้ว

เขาบอกเองใน [SECURITY.md](https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/main/SECURITY.md):

- เป็นเครื่องมือ privileged ท้องถิ่น ไม่ใช่ sandbox
- `allowedDirectories` จำกัดแค่เครื่องมือไฟล์ **เชลล์ออกนอกโฟลเดอร์ได้** (substitution, absolute path, interpreter อื่น)
- `blockedCommands` กันพลาด ไม่กันผู้ที่ตั้งใจเลี่ยง
- สมมติว่าไคลเอนต์ AI และบัญชีที่ต่อมา **ไว้ใจได้และไม่ถูกแฮก**
- isolation จริงมีแค่ Docker / VM ที่เมานต์โฟลเดอร์ทีละอัน
- มี telemetry นามแฝง (opt-out); ประวัติ `get_recent_tool_calls` อยู่บนเครื่อง ไม่ใช่ audit ฝั่งเซิร์ฟเวอร์

เคยมีช่องให้ AI ขยายสิทธิ์เองผ่าน `set_config_value` (ล้าง `blockedCommands` / `allowedDirectories=[]` = ทั้งดิสก์) รุ่นหลังล็อกคีย์พวกนี้จาก tool call แล้ว แต่ยังแก้ได้จาก UI

## เทียบกับของที่มีในฮับ

| ความต้องการ | ของที่มี | ช่องว่าง |
| --- | --- | --- |
| ค้นเอกสารงบ/ราชการ | `rag_*` ทั้งสาม hub | ไม่ใช่ไฟล์ระบบของโฮสต์ |
| สั่งคำสั่งบนเครื่องผู้ใช้ | `meshcentral_run_shell` บน admin hub | **ยังปิด** จนกว่า ai-tools-mcp + คิวคน + audit + hash ของ payload |
| สถานะเครื่องในไซต์ | Zabbix + Mesh inventory | ไม่ได้อ่านไฟล์บน compose host |
| อ่าน-เขียนไฟล์บนเครื่องที่รัน Docker | **ยังไม่มี** | อันนี้ที่ Desktop Commander ทำ — และอันตรายกว่า Mesh shell เพราะอยู่ที่เกตเวย์ |

`meshcentral_run_shell` สั่งบน **เอเจนต์** (Windows/Linux ในไซต์)  
Desktop Commander สั่งบน **เครื่องที่รัน MCP**  
ถ้าฝังบน `mcp-hub-admin` ที่อยู่หลัง tunnel สาธารณะ แปลว่า ChatGPT ที่ถือ `ADMIN_TOKEN` สั่งไฟล์/เชลล์บน compose host ได้ — พลาดโทเคนหรือโดน prompt injection = ทะลุเกตเวย์ ไม่ใช่แค่เครื่องพนักงานเครื่องหนึ่ง

ห้ามสับสนสองเส้นนี้:

- **Mesh shell** = เครื่องปลายทางในไซต์
- **Host MCP** = โฟลเดอร์ที่เมานต์เข้าคอนเทนเนอร์เกตเวย์

## สิ่งที่ห้ามทำ

1. `npx @wonderwhy-er/desktop-commander` ใน compose หรือต่อเป็น sub-mcp
2. เปิดเครื่องมือของเขาบน `/mcp/it` หรือ `/mcp/accounting`
3. `set_config_value` ให้โมเดลขยาย mount / ล้าง blocklist ตอนรัน
4. Telemetry ออกนอกไซต์
5. `read_file` ดึง URL ภายนอก (egress ซ้อน)
6. รัน Python/Node ในหน่วยความจำบนโฮสต์เกตเวย์
7. เปิดเชลล์/เขียนไฟล์ในรอบแรก
8. เปิดเป็นค่าเริ่ม — ไซต์ที่ `git pull` แล้วไม่ตั้งอะไรต้องทำงานเหมือนเดิม

## แนวที่เข้ากับฮับ

แพ็กเกจในรีโปเอง: `packages/mcp-host` → คอนเทนเนอร์ `sub-mcp-host`  
ฮับ **admin เท่านั้น** เรียกต่อเมื่อ `HOST_ENABLED=true`

ขอบเขตจริง = **โวลุ่มที่เมานต์เข้าคอนเทนเนอร์** ไม่ใช่รายการพาธใน JSON ที่โมเดลแก้ได้

```
Cloudflare Tunnel → Nginx Bearer admin
  → mcp-hub-admin
      → sub-mcp-host   (ค่าเริ่มไม่ขึ้น หรือขึ้นแล้วไม่ลงทะเบียนเครื่องมือ)
          volumes:  HOST_MOUNTS ที่ไซต์เลือก เมานต์ :ro
```

ไซต์ที่ยังไม่ใช้: ไม่ตั้ง `HOST_ENABLED` → ฮับ admin ไม่ต่อ backend นี้ → `tools/list` เท่าเดิม

## รอบแรกที่เสนอ (อ่านอย่างเดียว)

เครื่องมือ (ชื่อขึ้นต้น `host_` ไม่ชน `rag_` / Mesh):

| Tool | ทำอะไร |
| --- | --- |
| `host_get_status` | เปิดอยู่หรือไม่, รายชื่อ mount (ไม่ dump พาธโฮสต์ดิบถ้าไม่จำเป็น — ใช้ alias ในคอนเทนเนอร์), โหมด read-only |
| `host_list` | ลิสต์ไฟล์ใต้ mount ที่อนุญาต ความลึกจำกัด |
| `host_stat` | metadata (ขนาด, mtime, เป็นไฟล์หรือโฟลเดอร์) |
| `host_read` | อ่านข้อความ จำกัดบรรทัด/ไบต์ ไม่ตาม symlink ออกนอก jail |
| `host_search` | ค้นชื่อหรือเนื้อหาข้อความใต้ mount (ไม่ใช้ ripgrep ทั้งดิสก์) |

ยังไม่มีในรอบแรก: เขียน, ย้าย, mkdir, แก้ diff, Excel/PDF editor, เชลล์, เซสชันโปรเซส, ดึง URL, เปลี่ยนคอนฟิกตอนรัน

กติกา jail:

- พาธที่รับต้อง `realpath` แล้วอยู่ใต้ mount ที่ประกาศ
- ห้ามตาม symlink ที่ชี้ raนอก mount
- ไฟล์ไบนารีไม่ส่งทั้งก้อน — ส่งชนิด + ขนาด
- ลิมิตขนาดอ่านและจำนวนผลค้น
- ทุก `tools/call` ลง audit ท้องถิ่น (tool, พาธสัมพัทธ์, เวลา, ผล ok/error) — ไม่ส่งออกไซต์
- คอนเทนเนอร์รัน user `itops` ไม่ใช่ root; โวลุ่ม `:ro`

ค่าใน `.env` (ยังไม่เพิ่มจนกว่าจะลงมือ):

```
HOST_ENABLED=false
HOST_MOUNTS=           # ว่าง = ไม่มีเครื่องมือ แม้ ENABLED
# ตัวอย่างเมื่อเปิด:  ./data/host:/data/host:ro
HOST_MAX_READ_BYTES=1048576
HOST_MAX_LIST=200
```

อย่าเมานต์ `/`, `/etc`, `/var/lib/docker`, โฮม SSH, `.env` ของฮับ, หรือโฟลเดอร์บัญชีที่มี PII

งานที่ควรใช้รอบนี้: อ่านล็อกที่คัดแล้ว, ไฟล์คอนฟิกที่ไม่ลับที่ไซต์วางไว้ในโฟลเดอร์ allowlist, สคริปต์ปฏิบัติการที่อยากให้แอดมินถาม AI ได้โดยไม่เปิดเชลล์

งานที่ไม่ใช่รอบนี้: แทนที่ Mesh shell, แทนที่ RAG, แก้ไฟล์บนเครื่องพนักงาน, รัน `apt` / `docker compose` จากแชท

## รอบถัดไป (ยังไม่ขออนุมัติ)

เขียนไฟล์ใต้ mount `:rw` ที่แยกจากชุดอ่าน — ต้องมีคนเปิดธง `HOST_ALLOW_WRITE=true`

เชลล์บนโฮสต์ (`host_run_shell`) = **privileged ระดับเดียวกับ `meshcentral_run_shell`**

รอของชุดเดียวกัน:

1. ใบอนุมัติผูก hash ของ payload
2. มนุษย์เห็นคิวโดยไม่ต้องเปิดเซสชันค้าง
3. audit ที่ชี้ได้ว่าใครสั่ง
4. `tools.cancel` ไม่ติดคิวอนุมัติ

อย่าเปิดเชลล์โฮสต์ก่อน Mesh shell — อันตรายกว่าและยังไม่มีชั้นนั้น

## ทำไมไม่ reuse โค้ดเขา

- โมเดลภัยคุกคามคนละแบบ (localhost stdio vs tunnel สาธารณะ + Bearer บทบาท)
- เครื่องมือเยอะเกิน ChatGPT drop กลางเทิร์น (เคยเจอแล้วกับชุด accounting)
- `set_config` + telemetry + URL fetch ไม่เข้ากติกาไซต์
- ฮับมีแพทเทิร์น `packages/mcp-*` + fixture + smoke + `HUB_ROLE` อยู่แล้ว การ fork ทั้งก้อนแพงกว่าเขียนอ่านไฟล์ห้าตัว

แนวที่หยิบได้โดยไม่ copy โค้ด: jail พาธ, ลิมิตขนาด, ประวัติเรียกท้องถิ่น, เมานต์ Docker เป็นขอบเขตจริง

## ผลกระทบต่อไซต์ที่ pull `main`

รอบศึกษาครั้งนี้ **ไม่มีคอนเทนเนอร์ใหม่**  
เมื่อลงรอบแรก: ค่าเริ่มปิด — kknang / ICB / MTR / NST ที่ไม่ตั้ง `HOST_ENABLED` ต้องได้ `tools/list` ชุดเดิม

อย่าส่ง `ADMIN_TOKEN` ให้ทีมทดลองอยู่แล้ว ([TEAM-CONNECT.md](TEAM-CONNECT.md)) — เครื่องมือโฮสต์ถ้าเกิดจะอยู่เส้นนั้นเท่านั้น

## เกณฑ์พร้อมลงมือ

เจ้าของงานสั่งรอบแรก (เช่น «จัดเลย») และระบุอย่างน้อยหนึ่งอย่าง:

- เปิด fixture ในคอนเทนเนอร์เพื่อมีเครื่องมือให้ทดลองบน admin hub โดยไม่เมานต์ดิสก์จริง หรือ
- ระบุ alias + พาธโฮสต์ที่จะเมานต์ `:ro` (ไม่ dump ในโต๊ะ collab)

ก่อนนั้นเอกสารนี้คือสัญญาออกแบบ ไม่ใช่ฟีเจอร์ที่รันอยู่
