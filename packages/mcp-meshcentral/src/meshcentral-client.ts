import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { log } from "@itops/mcp-common";

export interface MeshCentralConfig {
  url: string;
  username: string;
  password: string;
  totp?: string;
  tlsInsecure: boolean;
  requestTimeoutMs: number;
}

export interface InventoryNode {
  id: string;
  name: string;
  os: string | null;
  cpu: string | null;
  ram: string | null;
  ip: string | null;
  online: boolean;
  meshid: string | null;
  last_connect: string | null;
}

interface Pending {
  action: string;
  responseid: string;
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function bytesToRam(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1024 * 1024) {
      const gib = value / (1024 * 1024 * 1024);
      if (gib >= 1) {
        return `${gib.toFixed(1)} GiB`;
      }
      return `${(value / (1024 * 1024)).toFixed(0)} MiB`;
    }
    return `${value} B`;
  }
  return asString(value);
}

function deepFind(obj: unknown, keys: string[]): unknown {
  const record = asRecord(obj);
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== "") {
      return record[key];
    }
  }
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") {
      const found = deepFind(nested, keys);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}

function extractIp(node: Record<string, unknown>): string | null {
  const direct = asString(node.ip) || asString(node.host);
  if (direct && /^[\d.:a-fA-F]+$/.test(direct)) {
    return direct;
  }
  const addr = node.addr ?? node.addresses ?? node.host;
  if (Array.isArray(addr)) {
    const first = addr.find((item) => typeof item === "string" && item.length > 0);
    return first ? String(first) : direct;
  }
  return asString(addr) || direct;
}

function extractCpu(node: Record<string, unknown>): string | null {
  const cpu = deepFind(node, [
    "cpu",
    "CPU",
    "cpuinfo",
    "cpuName",
    "processor",
    "Processor",
    "cpus",
  ]);
  if (Array.isArray(cpu) && cpu.length > 0) {
    const first = asRecord(cpu[0]);
    return asString(first?.name) || asString(cpu[0]);
  }
  const record = asRecord(cpu);
  return asString(record?.name) || asString(cpu);
}

function extractRam(node: Record<string, unknown>): string | null {
  const ram = deepFind(node, ["ram", "RAM", "memory", "Memory", "totalMemory", "mem"]);
  const record = asRecord(ram);
  if (record) {
    return bytesToRam(record.total ?? record.size ?? record.capacity) || asString(record.caption);
  }
  return bytesToRam(ram) || asString(ram);
}

function extractOs(node: Record<string, unknown>): string | null {
  const agent = asRecord(node.agent);
  return (
    asString(node.osdesc) ||
    asString(node.os) ||
    asString(agent?.desc) ||
    asString(agent?.osdesc) ||
    asString(deepFind(node, ["osdesc", "OSName", "caption"]))
  );
}

export function sanitizeNode(raw: unknown, meshid: string | null): InventoryNode | null {
  const node = asRecord(raw);
  if (!node) {
    return null;
  }
  const id = asString(node._id) || asString(node.id);
  if (!id) {
    return null;
  }
  const last =
    asString(node.lastconnect) ||
    asString(node.lastConnect) ||
    (typeof node.lastconnect === "number"
      ? new Date(node.lastconnect).toISOString()
      : null);
  return {
    id,
    name: asString(node.name) || asString(node.host) || id,
    os: extractOs(node),
    cpu: extractCpu(node),
    ram: extractRam(node),
    ip: extractIp(node),
    online: node.conn === 1 || node.conn === true || node.conn === "1",
    meshid: asString(node.meshid) || meshid,
    last_connect: last,
  };
}

function flattenNodes(payload: Record<string, unknown>): InventoryNode[] {
  const inventory: InventoryNode[] = [];
  const nodes = payload.nodes ?? payload.result ?? payload;
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      const sanitized = sanitizeNode(node, null);
      if (sanitized) {
        inventory.push(sanitized);
      }
    }
    return inventory;
  }
  const grouped = asRecord(nodes);
  if (!grouped) {
    return inventory;
  }
  for (const [meshid, list] of Object.entries(grouped)) {
    const arr = Array.isArray(list) ? list : [list];
    for (const node of arr) {
      const sanitized = sanitizeNode(node, meshid);
      if (sanitized) {
        inventory.push(sanitized);
      }
    }
  }
  return inventory;
}

function toControlWsUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  }
  url.pathname = "/control.ashx";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function meshAuthHeader(username: string, password: string, totp?: string): string {
  const parts = [Buffer.from(username, "utf8").toString("base64"), Buffer.from(password, "utf8").toString("base64")];
  if (totp) {
    parts.push(Buffer.from(totp, "utf8").toString("base64"));
  }
  return parts.join(",");
}

export class MeshCentralControlClient {
  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly pending = new Map<string, Pending>();
  private closedForever = false;

  constructor(private readonly config: MeshCentralConfig) {}

  async getInventory(): Promise<InventoryNode[]> {
    const reply = await this.request("nodes", {});
    return flattenNodes(reply);
  }

  async runShell(nodeId: string, command: string): Promise<Record<string, unknown>> {
    const inventory = await this.getInventory();
    const node = inventory.find((item) => item.id === nodeId || item.name === nodeId);
    if (!node) {
      throw new Error(`MeshCentral node '${nodeId}' was not found in the cached inventory`);
    }

    const os = (node.os ?? "").toLowerCase();
    const isWindows = os.includes("windows") || os.includes("win16") || os.includes("win32");
    const type = isWindows ? 1 : 2;

    const reply = await this.request(
      "runcommands",
      {
        nodeids: [node.id],
        type,
        cmds: command,
        runAsUser: 0,
        reply: true,
      },
      Math.max(this.config.requestTimeoutMs, 60_000),
    );

    return {
      node: {
        id: node.id,
        name: node.name,
        os: node.os,
        online: node.online,
      },
      shell_type: isWindows ? "powershell" : "linux",
      command,
      result: reply.result ?? reply.data ?? reply.msg ?? reply,
    };
  }

  close(): void {
    this.closedForever = true;
    this.failAll(new Error("MeshCentral client closed"));
    this.ws?.close();
    this.ws = null;
    this.connectPromise = null;
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }
    this.connectPromise = this.connect();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private connect(): Promise<void> {
    if (this.closedForever) {
      return Promise.reject(new Error("MeshCentral client is closed"));
    }

    const wsUrl = toControlWsUrl(this.config.url);
    log("info", "connecting to MeshCentral control channel", { url: wsUrl });

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        rejectUnauthorized: !this.config.tlsInsecure,
        headers: {
          "x-meshauth": meshAuthHeader(this.config.username, this.config.password, this.config.totp),
        },
      });

      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.terminate();
          reject(new Error(`Timed out connecting to MeshCentral at ${wsUrl}`));
        }
      }, 20_000);

      ws.on("open", () => {
        log("info", "MeshCentral websocket open, waiting for serverinfo");
      });

      ws.on("message", (data) => {
        const text = data.toString();
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(text) as Record<string, unknown>;
        } catch {
          log("warn", "MeshCentral sent non-JSON frame", { preview: text.slice(0, 180) });
          return;
        }

        if (message.action === "close") {
          const cause = asString(message.cause) || asString(message.msg) || "server closed";
          const error = new Error(`MeshCentral closed the control channel: ${cause}`);
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(error);
          }
          this.failAll(error);
          return;
        }

        if (message.action === "serverinfo" && !settled) {
          settled = true;
          clearTimeout(timeout);
          this.ws = ws;
          log("info", "MeshCentral control channel authenticated");
          resolve();
          return;
        }

        if (message.action === "ping") {
          ws.send(JSON.stringify({ action: "pong" }));
          return;
        }

        this.dispatch(message);
      });

      ws.on("unexpected-response", (_req, res) => {
        const error = new Error(`MeshCentral HTTP ${res.statusCode} while opening /control.ashx`);
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(error);
        }
      });

      ws.on("error", (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(error);
        } else {
          log("error", "MeshCentral websocket error", { err: error.message });
        }
      });

      ws.on("close", (code, reason) => {
        this.ws = null;
        const error = new Error(`MeshCentral websocket closed (${code} ${reason.toString()})`);
        this.failAll(error);
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
  }

  private dispatch(message: Record<string, unknown>): void {
    const responseid = asString(message.responseid);
    if (responseid && this.pending.has(responseid)) {
      const pending = this.pending.get(responseid);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(responseid);
        pending.resolve(message);
      }
      return;
    }

    const action = asString(message.action);
    if (!action) {
      return;
    }
    for (const [id, pending] of this.pending) {
      if (pending.action === action) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.resolve(message);
        return;
      }
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private async request(
    action: string,
    payload: Record<string, unknown>,
    timeoutMs = this.config.requestTimeoutMs,
  ): Promise<Record<string, unknown>> {
    await this.ensureConnected();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("MeshCentral control channel is not connected");
    }

    const responseid = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(responseid);
        reject(new Error(`MeshCentral '${action}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(responseid, { action, responseid, resolve, reject, timer });
      ws.send(JSON.stringify({ action, responseid, ...payload }));
    });
  }
}
