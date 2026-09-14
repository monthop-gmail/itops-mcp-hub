export const DEFAULT_LIMIT = 50;

export const FIXTURE_PARTNERS = [
  {
    id: 1,
    name: "บริษัท ตัวอย่าง ICB จำกัด",
    email: "icb-sample@example.com",
    city: "ขอนแก่น",
    is_company: true,
    country_id: [217, "Thailand"],
  },
  {
    id: 2,
    name: "หจก. ตัวอย่าง NST",
    email: "nst-sample@example.com",
    city: "นครราชสีมา",
    is_company: true,
    country_id: [217, "Thailand"],
  },
];

export const FIXTURE_MODELS = [
  { model: "res.partner", name: "Contact" },
  { model: "sale.order", name: "Sales Order" },
  { model: "account.move", name: "Journal Entry" },
  { model: "product.product", name: "Product" },
  { model: "ir.cron", name: "Scheduled Actions" },
  { model: "res.users", name: "Users" },
];

export const FIXTURE_VERSION = {
  server_version: "19.0-fixture",
  server_version_info: [19, 0, 0, "final", 0, ""],
  server_serie: "19.0",
  protocol_version: 1,
};

export const FIXTURE_CONTEXT = {
  server: "fixture",
  uid: 2,
  user: "MCP Bot (fixture)",
  login: "mcp-bot@example.com",
  company: [1, "บริษัท ตัวอย่าง Odoo จำกัด"],
  companies: [1],
  timezone: "Asia/Bangkok",
  language: "th_TH",
  note: "ข้อมูลจำลอง — Datetimes ใน Odoo จริงเป็น UTC",
};
