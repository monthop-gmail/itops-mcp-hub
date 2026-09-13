# RAG — คลังเอกสารท้องถิ่น (งบประมาณ / ราชการ)

เครื่องมือ `rag_*` ติดบน **ทั้งสาม hub** (`/mcp/it`, `/mcp/admin`, `/mcp/accounting`)  
ไม่เปิด URL ที่สี่ และไม่ต้องจัดโฟลเดอร์ใหม่ก่อนใช้

## ทำไมไม่ตัดโครงสร้างก่อน

ชุดที่ดึงจากรัฐ เช่น [เอกสารประกอบการพิจารณางบประมาณ 2570](https://www.parliament.go.th/view/88/%E0%B9%80%E0%B8%AD%E0%B8%81%E0%B8%AA%E0%B8%B2%E0%B8%A3%E0%B8%9B%E0%B8%A3%E0%B8%B0%E0%B8%81%E0%B8%AD%E0%B8%9A%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%9E%E0%B8%B4%E0%B8%88%E0%B8%B2%E0%B8%A3%E0%B8%93%E0%B8%B2_2570/TH-TH) มักเป็น PDF/ไฟล์ปนกันตามหน่วยงาน

แนวที่ใช้:

1. **โฟลเดอร์ตามที่ไซต์ดึงมา** คือโครงสร้าง — อินเด็กซ์เก็บ `path` สัมพัทธ์เป็น citation
2. **ค้นด้วย n-gram ไทย + รหัสละติน/ตัวเลข** ใน SQLite (Node ไม่ได้คอมไพล์ FTS5) ไม่ต้องรอโมเดล embedding ก่อน
3. **PDF** อ่านด้วย `pdftotext` (poppler) แบ่งหน้าด้วย form feed
4. ไฟล์ที่ยังไม่รองรับ (docx/xlsx/สแกนรูป) นับเป็น `skipped` ใน `rag_get_status` — แปลงเป็น PDF/ข้อความทีหลังได้โดยไม่ย้ายต้นฉบับ

เมื่ออยากจำกัดขอบเขต ค้นด้วย `path_prefix` เช่น `งบประมาณ-2570/กระทรวงมหาดไทย`

## เครื่องมือ

| Tool | ความหมาย |
| --- | --- |
| `rag_get_status` | fixture/files, จำนวนไฟล์/ชิ้น, กำลังอินเด็กซ์หรือยัง |
| `rag_list_sources` | รายการไฟล์ที่อ่านได้ |
| `rag_search` | คืน excerpt + path + หน้า + `chunk_id` |
| `rag_get_chunk` | อ่านชิ้นเต็ม |
| `rag_reindex` | สร้างอินเด็กซ์ใหม่จากโฟลเดอร์ (อ่านอย่างเดียว) |

ผลจาก fixture มี `sample: true`

## ตั้งค่า

ค่าเริ่ม `RAG_BACKEND=fixture` มีเอกสารงบ 2570 จำลอง

คลังจริงต่อไซต์ (kknang):

```
RAG_BACKEND=files
RAG_HOST_DATA_DIR=/mnt/c/data/2570
RAG_HOST_INDEX_DIR=./data/rag
```

แล้ว

```bash
docker compose up -d --build sub-mcp-rag mcp-hub-it mcp-hub-admin mcp-hub-accounting
```

อย่า commit ไฟล์งบจริงลง git

## สิ่งที่ยังไม่ทำในรอบนี้

- เวกเตอร์ embedding (BGE-M3 ฯลฯ) — เพิ่มเป็นชั้นที่ 2 เมื่อค้นคำพ้องที่ n-gram ไม่จับ
- OCR เอกสารสแกน
- แยก collection ตามบทบาท (ตอนนี้คลังเดียวกันทั้ง IT/admin/บัญชี เพราะเป็นเอกสารราชการชุดเดียวกันต่อไซต์)
