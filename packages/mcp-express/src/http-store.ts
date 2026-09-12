import type {
  ExpressBooks,
  ExpressGlAccount,
  ExpressInvoice,
  ExpressItem,
  ExpressParty,
  ExpressStore,
} from "./types.js";

export class HttpStore implements ExpressStore {
  readonly kind = "http" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async load(): Promise<ExpressBooks> {
    const status = asRecord(await this.getJson("/status"));
    const customers = await this.getJson("/customers");
    const vendors = await this.getJson("/vendors");
    const items = await this.getJson("/items");
    const arInvoices = await this.getJson("/ar-invoices");
    const glAccounts = await this.getJson("/gl-accounts");
    return {
      status: {
        ok: true,
        product: "Express Accounting",
        vendor: "https://express.co.th/",
        backend: "http",
        company_name: String(status.company_name ?? status.companyName ?? "Express"),
        sample: false,
        note: `HTTP adapter ${this.baseUrl} — สะพาน Windows/Cloud ที่คุณตั้งเอง เพราะ ESG ไม่เปิด REST สาธารณะ`,
      },
      customers: asTypedList<ExpressParty>(customers, "customers"),
      vendors: asTypedList<ExpressParty>(vendors, "vendors"),
      items: asTypedList<ExpressItem>(items, "items"),
      arInvoices: asTypedList<ExpressInvoice>(arInvoices, "arInvoices"),
      glAccounts: asTypedList<ExpressGlAccount>(glAccounts, "glAccounts"),
    };
  }

  private async getJson(path: string): Promise<Record<string, unknown> | unknown[]> {
    const url = new URL(path, this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`Express HTTP ${res.status} ${url.toString()}`);
    }
    return (await res.json()) as Record<string, unknown> | unknown[];
  }
}

function asRecord(body: unknown): Record<string, unknown> {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  return {};
}

function asTypedList<T>(body: unknown, key: string): T[] {
  if (Array.isArray(body)) {
    return body as T[];
  }
  if (body && typeof body === "object" && key in (body as object)) {
    const value = (body as Record<string, unknown>)[key];
    return Array.isArray(value) ? (value as T[]) : [];
  }
  return [];
}
