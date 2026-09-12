export interface RegisteredClient {
  clientId: string;
  clientSecret: string | null;
  clientName: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: string;
  createdAt: number;
}

export interface AuthCode {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  accessToken: string;
  role: "it" | "admin" | "accounting";
  expiresAt: number;
}

export interface RefreshGrant {
  refreshToken: string;
  clientId: string;
  accessToken: string;
  role: "it" | "admin" | "accounting";
  resource: string;
  scope: string;
  expiresAt: number;
}

const CODE_TTL_MS = 5 * 60 * 1000;
const CLIENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class MemoryStore {
  readonly clients = new Map<string, RegisteredClient>();
  readonly codes = new Map<string, AuthCode>();
  readonly refresh = new Map<string, RefreshGrant>();

  putClient(client: RegisteredClient): void {
    this.clients.set(client.clientId, client);
  }

  getClient(clientId: string): RegisteredClient | undefined {
    return this.clients.get(clientId);
  }

  putCode(entry: AuthCode): void {
    this.codes.set(entry.code, entry);
  }

  takeCode(code: string): AuthCode | undefined {
    const entry = this.codes.get(code);
    this.codes.delete(code);
    return entry;
  }

  putRefresh(entry: RefreshGrant): void {
    this.refresh.set(entry.refreshToken, entry);
  }

  takeRefresh(token: string): RefreshGrant | undefined {
    const entry = this.refresh.get(token);
    this.refresh.delete(token);
    return entry;
  }

  prune(now = Date.now()): void {
    for (const [id, client] of this.clients) {
      if (now - client.createdAt > CLIENT_TTL_MS) {
        this.clients.delete(id);
      }
    }
    for (const [code, entry] of this.codes) {
      if (entry.expiresAt <= now) {
        this.codes.delete(code);
      }
    }
    for (const [token, entry] of this.refresh) {
      if (entry.expiresAt <= now) {
        this.refresh.delete(token);
      }
    }
  }
}

export { CODE_TTL_MS, REFRESH_TTL_MS };
