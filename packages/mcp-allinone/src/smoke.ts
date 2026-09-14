import { invoiceFromArtr, itemFromInvmst, partyFromMaster, glFromGlmst, asDate } from "./map.js";
import { createAllinoneStore } from "./store.js";
import { MdbStore } from "./mdb-store.js";

async function main(): Promise<void> {
  process.env.ALLINONE_BACKEND = "fixture";
  const store = createAllinoneStore();
  const books = await store.load();
  if (!books.status.sample || books.customers.length < 1 || books.arInvoices.length < 1) {
    throw new Error("fixture books incomplete");
  }

  const customer = partyFromMaster({
    ACCID: "CUS-02",
    COMP: "บริษัท กิจการ ยอดเยี่ยม จำกัด",
    NAME: "คุณสมหมาย",
    TEL: "777-7777",
    ADD_1: "สะพานสูง",
    TAXNO: "0105550000000",
    NOWBAL: 301456.57,
  });
  if (customer.code !== "CUS-02" || customer.name !== "บริษัท กิจการ ยอดเยี่ยม จำกัด" || customer.balance !== 301456.57) {
    throw new Error(`ARMST mapping failed: ${JSON.stringify(customer)}`);
  }

  const item = itemFromInvmst({ ID: "FIN-01", DESC: "สินค้าสำเร็จรูป", UNIT: "ชิ้น", NOWBAL: 12, PRICE1: 500 });
  if (item.code !== "FIN-01" || item.on_hand !== 12) {
    throw new Error(`INVMST mapping failed: ${JSON.stringify(item)}`);
  }

  const names = new Map([["CUS-01", "ร้านกาแฟสองฤดู"]]);
  const openIv = invoiceFromArtr(
    {
      DOCNO: "IV6909-001",
      DATEDOC: "09/02/26 00:00:00",
      DUEDATE: "09/30/26 00:00:00",
      ACCID: "CUS-01",
      AMOUNT_D: 12840.5,
      NBAL: 12840.5,
      RECAMT: 0,
      VOID: "0",
    },
    names,
  );
  if (
    !openIv ||
    openIv.status !== "open" ||
    openIv.doc_date !== "2026-09-02" ||
    openIv.due_date !== "2026-09-30" ||
    openIv.customer_name !== "ร้านกาแฟสองฤดู"
  ) {
    throw new Error(`open ARTR mapping failed: ${JSON.stringify(openIv)}`);
  }

  const paid = invoiceFromArtr(
    { DOCNO: "IV6908-110", DATEDOC: "2026-08-18", ACCID: "CUS-01", AMOUNT_D: 21000, NBAL: 0, RECAMT: 21000, VOID: "" },
    names,
  );
  if (paid?.status !== "paid") {
    throw new Error(`paid ARTR mapping failed: ${JSON.stringify(paid)}`);
  }

  const voided = invoiceFromArtr(
    { DOCNO: "IV6907-001", DATEDOC: "2026-07-01", ACCID: "CUS-01", AMOUNT_D: 9, NBAL: 9, VOID: "Y" },
    names,
  );
  if (voided?.status !== "void") {
    throw new Error("void ARTR mapping failed");
  }

  if (invoiceFromArtr({ DOCNO: "RC6909-001", ACCID: "CUS-01", AMOUNT_D: 100, NBAL: 0 }, names)) {
    throw new Error("receipt RC* should not appear as an invoice");
  }

  if (asDate("01/23/05 00:00:00") !== "2005-01-23") {
    throw new Error(`date parse failed: ${asDate("01/23/05 00:00:00")}`);
  }

  const gl = glFromGlmst({ GLID: "1101", NAME: "เงินสด", GROUP: "A01", NATURE: "D", NOWBAL: 10 });
  if (gl.type !== "asset" || gl.code !== "1101") {
    throw new Error(`GLMST mapping failed: ${JSON.stringify(gl)}`);
  }
  if (glFromGlmst({ GLID: "4100", NAME: "ขาย", GROUP: "R01", NATURE: "C", NOWBAL: 1 }).type !== "income") {
    throw new Error("GL income group mapping failed");
  }
  if (glFromGlmst({ GLID: "5100", NAME: "ต้นทุน", GROUP: "E03", NATURE: "D", NOWBAL: 1 }).type !== "expense") {
    throw new Error("GL expense group mapping failed");
  }

  const demoPath = process.env.ALLINONE_SMOKE_MDB;
  if (demoPath) {
    const dir = demoPath.slice(0, demoPath.lastIndexOf("/"));
    const file = demoPath.slice(demoPath.lastIndexOf("/") + 1);
    const live = await new MdbStore(dir, file, "").load();
    if (live.status.sample || live.status.backend !== "mdb") {
      throw new Error(`expected live mdb books: ${JSON.stringify(live.status)}`);
    }
    if (live.customers.length < 1 || live.arInvoices.length < 1 || live.glAccounts.length < 1) {
      throw new Error(
        `demo mdb incomplete customers=${live.customers.length} invoices=${live.arInvoices.length} gl=${live.glAccounts.length}`,
      );
    }
    const paidLive = live.arInvoices.filter((row) => row.status === "paid").length;
    const openLive = live.arInvoices.filter((row) => row.status === "open").length;
    if (paidLive < 1 || openLive < 1) {
      throw new Error(`demo ARTR status split failed paid=${paidLive} open=${openLive}`);
    }
    console.log(
      "allinone mdb smoke ok",
      live.status.company_name,
      "customers",
      live.customers.length,
      "invoices",
      live.arInvoices.length,
    );
  }

  console.log("allinone fixture smoke ok", books.status.company_name, books.customers.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
