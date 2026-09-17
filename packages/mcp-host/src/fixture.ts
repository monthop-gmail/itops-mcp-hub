import { mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const FIXTURE_NOTE =
  "ข้อมูลจำลอง — ไม่ได้อ่านดิสก์โฮสต์จริง. เปิด HOST_BACKEND=files + เมานต์โฟลเดอร์ :ro เมื่อไซต์พร้อม. ไม่มีเชลล์/เขียนในรอบนี้";

export function writeFixtureHost(root = join(tmpdir(), `itops-host-fixture-${process.pid}`)): string {
  mkdirSync(join(root, "runbooks"), { recursive: true });
  mkdirSync(join(root, "notes"), { recursive: true });
  mkdirSync(join(root, "secret"), { recursive: true });
  writeFileSync(
    join(root, "README.md"),
    "# Host fixture\n\nโฟลเดอร์จำลองสำหรับเครื่องมือ host_* บนฮับ admin\nค่าเริ่มต้นอ่านอย่างเดียว ไม่มีเชลล์\nค้นคำว่า restart-nginx เพื่อทดสอบ host_search\n",
    "utf8",
  );
  writeFileSync(
    join(root, "runbooks", "restart-nginx.md"),
    "# Restart nginx\n\n1. ตรวจ healthz\n2. docker compose restart nginx\n3. อย่ารีสตาร์ท cloudflared ถ้าไม่จำเป็น\n",
    "utf8",
  );
  writeFileSync(join(root, "notes", "sample.txt"), "บันทึกตัวอย่างสำหรับ host_read\nบรรทัดสอง\n", "utf8");
  writeFileSync(join(root, "bin-sample.dat"), Buffer.from([0x00, 0x01, 0x02, 0xff, 0x10, 0x20]));
  writeFileSync(join(root, "secret", ".env"), "ADMIN_TOKEN=not-a-real-token\n", "utf8");
  writeFileSync(
    join(root, "secret", "README.md"),
    "โฟลเดอร์นี้มีไฟล์ที่ถูกกัน (.env / คีย์) จึงไม่โผล่ใน host_list และอ่านไม่ได้\nนี่ไม่ใช่บั๊ก — ใช้ทดสอบว่าของลับไม่รั่วผ่าน MCP\n",
    "utf8",
  );
  try {
    symlinkSync("/etc/passwd", join(root, "escape-link"));
  } catch {
    // some CI filesystems refuse symlinks; smoke treats missing link as skip
  }
  return root;
}
