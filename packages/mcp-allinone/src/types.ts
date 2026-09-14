export type AllinoneBackendKind = "fixture" | "mdb" | "mysql";
export type AllinoneEdition = "vm" | "cs" | "unknown";

export interface AllinoneStatus {
  ok: boolean;
  product: "Allinone";
  vendor: "https://www.allinonesoft.com/";
  edition: AllinoneEdition;
  backend: AllinoneBackendKind;
  company_name: string;
  sample: boolean;
  source?: string;
  tables?: string[];
  note: string;
}

export interface AllinoneParty {
  code: string;
  name: string;
  contact?: string;
  tax_id?: string;
  phone?: string;
  address?: string;
  balance?: number;
}

export interface AllinoneItem {
  code: string;
  name: string;
  unit?: string;
  on_hand?: number;
  unit_price?: number;
}

export interface AllinoneInvoice {
  doc_no: string;
  doc_date: string;
  customer_code: string;
  customer_name: string;
  amount: number;
  balance: number;
  status: "open" | "paid" | "void";
  due_date?: string;
}

export interface AllinoneGlAccount {
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  balance: number;
}

export interface AllinoneBooks {
  status: AllinoneStatus;
  customers: AllinoneParty[];
  vendors: AllinoneParty[];
  items: AllinoneItem[];
  arInvoices: AllinoneInvoice[];
  glAccounts: AllinoneGlAccount[];
}

export interface AllinoneStore {
  kind: AllinoneBackendKind;
  load(): Promise<AllinoneBooks>;
  inspect?(): Promise<{ tables: string[]; columns: Record<string, string[]> }>;
}

export type AllinoneRow = Record<string, unknown>;
