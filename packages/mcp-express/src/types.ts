export type ExpressBackendKind = "fixture" | "http" | "dbf";

export interface ExpressStatus {
  ok: boolean;
  product: "Express Accounting";
  vendor: "https://express.co.th/";
  backend: ExpressBackendKind;
  company_name: string;
  sample: boolean;
  note: string;
}

export interface ExpressParty {
  code: string;
  name: string;
  tax_id?: string;
  phone?: string;
  address?: string;
  balance?: number;
}

export interface ExpressItem {
  code: string;
  name: string;
  unit?: string;
  on_hand?: number;
  unit_price?: number;
}

export interface ExpressInvoice {
  doc_no: string;
  doc_date: string;
  customer_code: string;
  customer_name: string;
  amount: number;
  balance: number;
  status: "open" | "paid" | "void";
}

export interface ExpressGlAccount {
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  balance: number;
}

export interface ExpressBooks {
  status: ExpressStatus;
  customers: ExpressParty[];
  vendors: ExpressParty[];
  items: ExpressItem[];
  arInvoices: ExpressInvoice[];
  glAccounts: ExpressGlAccount[];
}

export interface ExpressStore {
  kind: ExpressBackendKind;
  load(): Promise<ExpressBooks>;
}
