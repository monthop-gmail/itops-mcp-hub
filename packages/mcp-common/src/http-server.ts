import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { log } from "./log.js";

export type McpServerFactory = () => McpServer;

export interface ServeMcpHttpOptions {
  name: string;
  version: string;
  port: number;
  /**
   * Public URL prefix as seen by MCP clients (e.g. `/mcp/it`).
   * Used so legacy SSE transports advertise `/mcp/it/messages` while Nginx
   * strips the prefix and the process listens on `/messages`.
   */
  publicBasePath?: string;
}

type TransportEntry =
  | { kind: "streamable"; transport: StreamableHTTPServerTransport }
  | { kind: "sse"; transport: SSEServerTransport };

function normalizeBase(path: string | undefined): string {
  if (!path) {
    return "";
  }
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function jsonRpcError(res: Response, status: number, message: string): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  });
}

/**
 * Serves MCP over Streamable HTTP (`/mcp`) and legacy SSE (`/sse` + `/messages`).
 */
export function serveMcpHttp(createServer: McpServerFactory, options: ServeMcpHttpOptions): void {
  const publicBase = normalizeBase(options.publicBasePath);
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "4mb" }));

  const sessions = new Map<string, TransportEntry>();

  const health = (_req: Request, res: Response) => {
    res.status(200).json({
      ok: true,
      service: options.name,
      version: options.version,
      transports: ["streamable-http", "sse"],
    });
  };

  app.get("/healthz", health);
  app.get("/health", health);

  app.get("/", (_req, res) => {
    res.status(200).json({
      service: options.name,
      version: options.version,
      endpoints: {
        healthz: "/healthz",
        streamableHttp: `${publicBase || ""}/mcp`,
        sse: `${publicBase || ""}/sse`,
        sseMessages: `${publicBase || ""}/messages`,
      },
    });
  });

  const handleStreamable = async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    try {
      if (sessionId) {
        const existing = sessions.get(sessionId);
        if (!existing) {
          jsonRpcError(res, 404, "Unknown MCP session");
          return;
        }
        if (existing.kind !== "streamable") {
          jsonRpcError(res, 400, "Session exists but uses a different transport");
          return;
        }
        await existing.transport.handleRequest(req, res, req.body);
        return;
      }

      if (req.method === "POST" && isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableDnsRebindingProtection: false,
          onsessioninitialized: (sid) => {
            sessions.set(sid, { kind: "streamable", transport });
            log("info", "streamable session initialized", {
              service: options.name,
              sessionId: sid,
            });
          },
        });
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) {
            sessions.delete(sid);
            log("info", "streamable session closed", {
              service: options.name,
              sessionId: sid,
            });
          }
        };
        const server = createServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      jsonRpcError(res, 400, "Bad Request: missing mcp-session-id or initialize body");
    } catch (error) {
      log("error", "streamable HTTP handler failed", {
        service: options.name,
        err: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        jsonRpcError(res, 500, "Internal MCP transport error");
      }
    }
  };

  app.all("/mcp", handleStreamable);
  if (publicBase) {
    app.all(`${publicBase}/mcp`, handleStreamable);
  }

  const handleSseOpen = async (req: Request, res: Response): Promise<void> => {
    try {
      const postPath = `${publicBase}/messages` || "/messages";
      const transport = new SSEServerTransport(postPath, res);
      sessions.set(transport.sessionId, { kind: "sse", transport });
      log("info", "sse session opened", {
        service: options.name,
        sessionId: transport.sessionId,
        postPath,
      });
      res.on("close", () => {
        sessions.delete(transport.sessionId);
        log("info", "sse session closed", {
          service: options.name,
          sessionId: transport.sessionId,
        });
      });
      const server = createServer();
      await server.connect(transport);
    } catch (error) {
      log("error", "sse open failed", {
        service: options.name,
        err: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        res.status(500).send("Failed to open SSE transport");
      }
    }
  };

  const handleSseMessage = async (req: Request, res: Response): Promise<void> => {
    const sessionId = String(req.query.sessionId ?? "");
    const existing = sessions.get(sessionId);
    if (!existing || existing.kind !== "sse") {
      jsonRpcError(res, 400, "No SSE transport for sessionId");
      return;
    }
    try {
      await existing.transport.handlePostMessage(
        req as IncomingMessage,
        res as ServerResponse,
        req.body,
      );
    } catch (error) {
      log("error", "sse message failed", {
        service: options.name,
        sessionId,
        err: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        jsonRpcError(res, 500, "Failed to handle SSE message");
      }
    }
  };

  app.get("/sse", handleSseOpen);
  app.post("/messages", handleSseMessage);
  if (publicBase) {
    app.get(`${publicBase}/sse`, handleSseOpen);
    app.post(`${publicBase}/messages`, handleSseMessage);
  }

  app.listen(options.port, "0.0.0.0", () => {
    log("info", "MCP HTTP server listening", {
      service: options.name,
      port: options.port,
      publicBasePath: publicBase || "/",
    });
  });
}
