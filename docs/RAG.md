# RAG — คลังเอกสารท้องถิ่น (งบประมาณ / ราชการ)

เครื่องมือ `rag_*` ติดบน **ทั้งสาม hub** (`/mcp/it`, `/mcp/admin`, `/mcp/accounting`)  
ไม่เปิด URL ที่สี่ และไม่ต้องจัดโฟลเดอร์ใหม่ก่อนใช้

## ทำไมไม่ตัดโครงสร้างก่อน

ชุดที่ดึงจากรัฐ เช่น [เอกสารประกอบการพิจารณางบประมาณ 2570](https://www.parliament.go.th/view/88/%E0%B9%80%E0%B8%AD%E0%B8%81%E0%B8%AA%E0%B8%B2%E0%B8%A3%E0%B8%9B%E0%B8%A3%E0%B8%B0%E0%B8%81%E0%B8%AD%E0%B8%9A%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%9E%E0%B8%B4%E0%B8%88%E0%B8%B2%E0%B8%A3%E0%B8%93%E0%B8%B2_2570/TH-TH) มักเป็น PDF/ไฟล์ปนกันตามหน่วยงาน

แนวที่ใช้:

1. **โฟลเดอร์ตามที่ไซต์ดึงมา** คือโครงสร้าง — อินเด็กซ์เก็บ `path` สัมพัทธ์เป็น citation
2. **ค้นด้วย FTS5 trigram** ผ่าน `better-sqlite3` (คอมไพล์มาพร้อม `SQLITE_ENABLE_FTS5` อยู่แล้ว ไม่ต้อง amalgamation เอง) — ภาษาไทยไม่มีช่องว่างระหว่างคำ เลยใช้ tokenizer `trigram` ไม่ใช่ `unicode61`. คำสั้นกว่า 3 ตัวอักษรตกไป `LIKE`. `node:sqlite` ของ Node 22 **ไม่มี** FTS5
3. **PDF** อ่านด้วย `pdftotext` (poppler) ครั้งเดียวต่อไฟล์ แล้วแบ่งหน้าด้วย form feed + `pdfinfo`
4. หน้าที่มีตัวอักษรที่มองเห็นได้น้อยกว่า `RAG_OCR_MIN_CHARS` (ค่าเริ่ม 40) **ไม่ถูกอินเด็กซ์ว่าง ๆ** — เข้าคิว OCR แทน
5. ไฟล์ที่ยังไม่รองรับ (docx/xlsx/รูปเดี่ยว) นับเป็น `skipped` ใน `rag_get_status` — แปลงเป็น PDF/ข้อความทีหลังได้โดยไม่ย้ายต้นฉบับ

เมื่ออยากจำกัดขอบเขต ค้นด้วย `path_prefix` เช่น `งบประมาณ-2570/กระทรวงมหาดไทย`

## เครื่องมือ

| Tool | ความหมาย |
| --- | --- |
| `rag_get_status` | fixture/files, จำนวนไฟล์/ชิ้น, คิว OCR, กำลังอินเด็กซ์หรือยัง |
| `rag_list_sources` | รายการไฟล์ที่อ่านได้ |
| `rag_search` | คืน excerpt + path + หน้า + `chunk_id` |
| `rag_get_chunk` | อ่านชิ้นเต็ม |
| `rag_reindex` | สร้างอินเด็กซ์ใหม่จากโฟลเดอร์ (อ่านอย่างเดียว; คิวที่ approve/reject/done ไม่ถูกลบทิ้ง) |
| `rag_ocr_status` | นับ pending/approved/rejected/done + ธงภาพ |
| `rag_list_ocr_queue` | รายการงาน (ค่าเริ่ม pending) — ไม่มีภาพ |
| `rag_review_ocr_job` | `approve` หรือ `reject` |
| `rag_get_ocr_page` | metadata/excerpt; ภาพเฉพาะเมื่อเปิดธงและงานถูก approve |
| `rag_run_ocr` | ส่งหน้าที่ approve แล้วไปค่าย OCR (ค่าเริ่ม Typhoon) — ไม่ยิงทั้งคลัง |
| `rag_submit_ocr` | บันทึกข้อความเป็น sidecar แล้วอินเด็กซ์หน้านี้ — **ต้อง approve ก่อน** |

ผลจาก fixture มี `sample: true`

## คิว OCR

ไม่ OCR ทั้งคลัง — `pdftotext` ยังเป็นค่าเริ่ม

1. หน้าที่เลือกข้อความได้น้อยเข้าคิว `pending`
2. คน/เอเจนต์ในไซต์ `approve` หรือ `reject` ก่อนข้อความหรือภาพออกจากเครื่อง
3. `rag_submit_ocr` เขียน sidecar ใต้โฟลเดอร์อินเด็กซ์ **ไม่ทับ PDF ต้นทาง** (โวลุ่มเอกสารเมานต์ `:ro`)

```
${RAG_HOST_INDEX_DIR}/ocr/<path>.p<หน้า>.ocr.md
```

ตัวอย่าง: `/data/rag/ocr/งบประมาณ-2570/สำนักงบประมาณ/แบบสแกน.pdf.p3.ocr.md`

คิวเดียวกันเรียกคนงานค่ายได้ทีละหน้าด้วย `rag_run_ocr` หลัง **approve** — ค่าเริ่ม Typhoon OCR 1.5 (`typhoon-ocr` ที่ `https://api.opentyphoon.ai/v1`). ไม่ยิงทั้งคลังอัตโนมัติ. `save=true` จึงเขียน sidecar

คลาวด์ ChatGPT / Grok / Gemini **ดึงไฟล์ใน LAN ไม่ได้** — ถ้าต้องการให้โมเดลสายตาช่วยอ่าน ให้ตั้ง `RAG_OCR_INCLUDE_IMAGE=true` แล้วเรียก `rag_get_ocr_page` หลัง approve (JPEG จาก `pdftoppm` จำกัด ~1.5MB) ค่าเริ่ม `false`

อย่าส่งคลัง 2570 ทั้งก้อนออก API สาธารณะ — คัดกรองทีละหน้า

Fixture ไม่มี PDF สแกนจริง — มีงานทดสอบ 2 หน้าที่ `งบประมาณ-2570/สำนักงบประมาณ/แบบสแกน-ปก.pdf` เพื่อให้เครื่องมือคิวทำงาน

## ค่าย OCR

ค่าเริ่ม `RAG_OCR_PROVIDER=typhoon`. คีย์อยู่ที่ `.env` ของไซต์ (`TYPHOON_API_KEY`) **ห้าม commit**

| ค่า | ความหมาย |
| --- | --- |
| `TYPHOON_API_BASE` | ค่าเริ่ม `https://api.opentyphoon.ai/v1` |
| `TYPHOON_OCR_MODEL` | ค่าเริ่ม `typhoon-ocr` (OCR 1.5). รับ alias `openai/typhoon-ocr` และ `openai/typhoon-ocr-v1.5` |
| รุ่นเก่า | `typhoon-ocr-preview` (จะเลิก 31 ธ.ค. 2025) |

ค่ายอื่นส่งคีย์มาทีหลัง ใส่ใน `.env` แล้วต่อ `RAG_OCR_PROVIDER=<id>` — เลย์เอาต์ sidecar / คิวไม่เปลี่ยน

## ตั้งค่า

ค่าเริ่ม `RAG_BACKEND=fixture` มีเอกสารงบ 2570 จำลอง

คลังจริงต่อไซต์ (kknang):

```
RAG_BACKEND=files
RAG_HOST_DATA_DIR=/mnt/c/data/2570
RAG_HOST_INDEX_DIR=./data/rag
RAG_OCR_INCLUDE_IMAGE=false
RAG_OCR_MIN_CHARS=40
RAG_OCR_PROVIDER=typhoon
TYPHOON_API_KEY=
TYPHOON_API_BASE=https://api.opentyphoon.ai/v1
TYPHOON_OCR_MODEL=typhoon-ocr
```

แล้ว

```bash
docker compose up -d --build sub-mcp-rag mcp-hub-it mcp-hub-admin mcp-hub-accounting
```

คลัง PDF ใหญ่ (เช่น ~285MB ที่ kknang) จะอินเด็กซ์หลัง `/healthz` พร้อมแล้ว — `rag_get_status.indexing=true` จนกว่าจะ `ready`. อย่า commit ไฟล์งบจริงลง git

หลังอัปเดตเอนจิน อินเด็กซ์เก่า (`ngrams`) ถูกทิ้งแล้วสร้าง `chunks_fts` ใหม่ตอนบูต — ตาราง `ocr_jobs` อยู่ต่อได้ ถ้ามี sidecar จะถูกอ่านกลับเข้าอินเด็กซ์ ที่ kknang ให้ recreate `sub-mcp-rag` แล้วรอ `rag_get_status.ready`

## สิ่งที่ยังไม่ทำในรอบนี้

- เวกเตอร์ embedding (BGE-M3 ฯลฯ) — เพิ่มเป็นชั้นที่ 2 เมื่อค้นคำพ้องที่ FTS5 ไม่จับ
- คนงาน OCR อัตโนมัติทั้งคลัง / ค่ายอื่นนอกจาก Typhoon — คิว + Typhoon ทีละหน้าพร้อมแล้ว
- แยก collection ตามบทบาท (ตอนนี้คลังเดียวกันทั้ง IT/admin/บัญชี เพราะเป็นเอกสารราชการชุดเดียวกันต่อไซต์)
