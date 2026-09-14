export type PstackBackendKind = "fixture" | "http";

export interface PstackToolInfo {
  name: string;
  description: string;
  input_schema?: Record<string, unknown>;
}

export interface PstackStatus {
  ok: boolean;
  product: "pstack";
  vendor: "https://github.com/willpower-institute/pstack";
  backend: PstackBackendKind;
  sample: boolean;
  url?: string;
  app?: string;
  modules?: string[];
  server_name?: string;
  server_version?: string;
  tenant_id?: string;
  tool_count?: number;
  note: string;
}

export interface PstackCallResult {
  ok: boolean;
  tool: string;
  tenant_id?: string;
  is_error: boolean;
  text: string;
}

export class PstackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PstackError";
  }
}

export interface PstackStore {
  kind: PstackBackendKind;
  status(): Promise<PstackStatus>;
  listTools(query?: string): Promise<PstackToolInfo[]>;
  callTool(name: string, args: Record<string, unknown>, tenantId?: string): Promise<PstackCallResult>;
}
