import type { AllinoneBooks, AllinoneStore } from "./types.js";

const NOTE =
  "ข้อมูลจำลองใน fixture — Allinone CS = MySQL, Allinone VM = Microsoft Access (.mdb). ต่อสมุดจริงด้วย ALLINONE_BACKEND=mdb หรือ mysql";

export function fixtureBooks(): AllinoneBooks {
  return {
    status: {
      ok: true,
      product: "Allinone",
      vendor: "https://www.allinonesoft.com/",
      edition: "vm",
      backend: "fixture",
      company_name: "บริษัท ตัวอย่าง Allinone จำกัด",
      sample: true,
      tables: ["ARMST", "APMST", "INVMST", "ARTR", "GLMST", "CONFIG"],
      note: NOTE,
    },
    customers: [
      {
        code: "CUS-01",
        name: "ร้านกาแฟสองฤดู",
        contact: "คุณเดือน",
        tax_id: "0105559999991",
        phone: "043-000-111",
        address: "ขอนแก่น",
        balance: 12840.5,
      },
      {
        code: "CUS-02",
        name: "หจก. คลังวัสดุก่อสร้างบ้านนา",
        tax_id: "0495558888882",
        phone: "043-000-222",
        address: "บ้านไผ่",
        balance: 0,
      },
    ],
    vendors: [
      {
        code: "SUP-01",
        name: "บจก. วัตถุดิบอีสาน",
        tax_id: "0105547777773",
        phone: "02-217-0000",
        address: "กรุงเทพฯ",
        balance: 5600,
      },
    ],
    items: [
      { code: "FIN-01", name: "เมล็ดกาแฟคั่ว 1 กก.", unit: "ถุง", on_hand: 42, unit_price: 320 },
      { code: "FIN-02", name: "แก้วกระดาษ 16 oz", unit: "ใบ", on_hand: 1200, unit_price: 3.5 },
    ],
    arInvoices: [
      {
        doc_no: "IV6909-001",
        doc_date: "2026-09-02",
        customer_code: "CUS-01",
        customer_name: "ร้านกาแฟสองฤดู",
        amount: 12840.5,
        balance: 12840.5,
        status: "open",
        due_date: "2026-09-30",
      },
      {
        doc_no: "IV6908-110",
        doc_date: "2026-08-18",
        customer_code: "CUS-02",
        customer_name: "หจก. คลังวัสดุก่อสร้างบ้านนา",
        amount: 21000,
        balance: 0,
        status: "paid",
      },
    ],
    glAccounts: [
      { code: "1101", name: "เงินสด", type: "asset", balance: 85420.25 },
      { code: "1105", name: "ลูกหนี้การค้า", type: "asset", balance: 12840.5 },
      { code: "2102", name: "เจ้าหนี้การค้า", type: "liability", balance: 5600 },
      { code: "4100", name: "รายได้ขาย", type: "income", balance: 186500 },
      { code: "5100", name: "ต้นทุนขาย", type: "expense", balance: 74200 },
    ],
  };
}

export class FixtureStore implements AllinoneStore {
  readonly kind = "fixture" as const;
  async load(): Promise<AllinoneBooks> {
    return fixtureBooks();
  }
  async inspect() {
    return {
      tables: ["ARMST", "APMST", "INVMST", "ARTR", "GLMST", "CONFIG"],
      columns: {
        ARMST: ["ACCID", "COMP", "NAME", "TEL", "TAXNO", "NOWBAL"],
        APMST: ["ACCID", "COMP", "NAME", "TEL", "TAXNO", "NOWBAL"],
        INVMST: ["ID", "DESC", "UNIT", "NOWBAL", "PRICE1"],
        ARTR: ["DOCNO", "DATEDOC", "ACCID", "AMOUNT_D", "NBAL", "VOID"],
        GLMST: ["GLID", "NAME", "GROUP", "NATURE", "NOWBAL"],
        CONFIG: ["COMPNAME"],
      },
    };
  }
}
