import type { ExpressBooks, ExpressStore } from "./types.js";

const NOTE =
  "ข้อมูลจำลองใน fixture — Express Accounting (express.co.th) ไม่มี REST API สาธารณะ. ต่อสมุดจริงด้วย EXPRESS_BACKEND=http หรือ dbf";

export function fixtureBooks(): ExpressBooks {
  return {
    status: {
      ok: true,
      product: "Express Accounting",
      vendor: "https://express.co.th/",
      backend: "fixture",
      company_name: "บริษัท ตัวอย่าง kknang จำกัด",
      sample: true,
      note: NOTE,
    },
    customers: [
      {
        code: "C001",
        name: "ร้านกาแฟสองฤดู",
        tax_id: "0105559999991",
        phone: "043-000-111",
        address: "ขอนแก่น",
        balance: 12840.5,
      },
      {
        code: "C002",
        name: "หจก. คลังวัสดุก่อสร้างบ้านนา",
        tax_id: "0495558888882",
        phone: "043-000-222",
        address: "บ้านไผ่",
        balance: 0,
      },
    ],
    vendors: [
      {
        code: "S001",
        name: "บจก. วัตถุดิบอีสาน",
        tax_id: "0105547777773",
        phone: "02-217-0000",
        address: "กรุงเทพฯ",
        balance: 5600,
      },
    ],
    items: [
      { code: "P-COFFEE", name: "เมล็ดกาแฟคั่ว 1 กก.", unit: "ถุง", on_hand: 42, unit_price: 320 },
      { code: "P-CUP", name: "แก้วกระดาษ 16 oz", unit: "ใบ", on_hand: 1200, unit_price: 3.5 },
    ],
    arInvoices: [
      {
        doc_no: "IV68090001",
        doc_date: "2026-09-02",
        customer_code: "C001",
        customer_name: "ร้านกาแฟสองฤดู",
        amount: 12840.5,
        balance: 12840.5,
        status: "open",
      },
      {
        doc_no: "IV68080110",
        doc_date: "2026-08-18",
        customer_code: "C002",
        customer_name: "หจก. คลังวัสดุก่อสร้างบ้านนา",
        amount: 21000,
        balance: 0,
        status: "paid",
      },
    ],
    glAccounts: [
      { code: "1110", name: "เงินสด", type: "asset", balance: 85420.25 },
      { code: "1120", name: "ลูกหนี้การค้า", type: "asset", balance: 12840.5 },
      { code: "2110", name: "เจ้าหนี้การค้า", type: "liability", balance: 5600 },
      { code: "4100", name: "รายได้ขาย", type: "income", balance: 186500 },
      { code: "5100", name: "ต้นทุนขาย", type: "expense", balance: 74200 },
    ],
  };
}

export class FixtureStore implements ExpressStore {
  readonly kind = "fixture" as const;
  async load(): Promise<ExpressBooks> {
    return fixtureBooks();
  }
}
