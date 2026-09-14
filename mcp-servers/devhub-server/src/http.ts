#!/usr/bin/env tsx
/**
 * DevHub MCP over Streamable HTTP, for clients that connect to a URL instead of
 * spawning a stdio process.
 *
 *   npm run mcp:http            → http://127.0.0.1:1340/mcp
 *
 * Same tools, history and toolsets as the stdio server (server.ts), with one
 * McpServer per client session. Every request needs `Authorization: Bearer
 * <token>` and a loopback Host/Origin — see http-auth.ts for why loopback alone
 * is not enough.
 */
import { randomUUID } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createContext } from "./context.ts";
import {
  bearerMatches,
  DEFAULT_MCP_HTTP_PORT,
  isAllowedHost,
  isAllowedOrigin,
  parseAllowedHosts,
  resolveMcpHttpToken,
} from "./http-auth.ts";
import { createDevhubMcpServer, startupHousekeeping } from "./server.ts";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

const port = Number.parseInt(process.env.DEVHUB_MCP_HTTP_PORT ?? "", 10) || DEFAULT_MCP_HTTP_PORT;
const host = process.env.DEVHUB_MCP_HTTP_HOST?.trim() || "127.0.0.1";
const extraHosts = parseAllowedHosts(process.env.DEVHUB_MCP_HTTP_ALLOWED_HOSTS);
const { token, source, file: tokenFile } = resolveMcpHttpToken();
const ctx = createContext();
startupHousekeeping();

const sessions = new Map<string, StreamableHTTPServerTransport>();

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendRpcError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { jsonrpc: "2.0", error: { code: -32000, message }, id: null });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as unknown) : undefined;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  if (pathname !== "/mcp") return sendJson(res, 404, { error: "Not found — the MCP endpoint is /mcp" });
  if (!isAllowedHost(req.headers.host, extraHosts) || !isAllowedOrigin(req.headers.origin, extraHosts)) {
    return sendJson(res, 403, { error: "Forbidden host or origin" });
  }
  if (!bearerMatches(req.headers.authorization, token)) {
    res.setHeader("www-authenticate", "Bearer");
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const header = req.headers["mcp-session-id"];
  const sessionId = Array.isArray(header) ? header[0] : header;

  if (req.method === "POST") {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendRpcError(res, 400, `Invalid request body: ${err instanceof Error ? err.message : String(err)}`);
    }
    const existing = sessionId ? sessions.get(sessionId) : undefined;
    if (existing) return existing.handleRequest(req, res, body);
    if (sessionId) return sendRpcError(res, 404, "Unknown session — initialize again");
    if (!isInitializeRequest(body)) return sendRpcError(res, 400, "No session: the first request must be initialize");

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, transport);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    const { server } = createDevhubMcpServer(ctx);
    await server.connect(transport);
    return transport.handleRequest(req, res, body);
  }

  if (req.method === "GET" || req.method === "DELETE") {
    const transport = sessionId ? sessions.get(sessionId) : undefined;
    if (!transport) return sendRpcError(res, sessionId ? 404 : 400, "Unknown or missing session");
    return transport.handleRequest(req, res);
  }

  res.setHeader("allow", "GET, POST, DELETE");
  return sendJson(res, 405, { error: "Method not allowed" });
}

const httpServer = http.createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    console.error("DevHub MCP (HTTP) request failed:", err);
    if (!res.headersSent) sendRpcError(res, 500, "Internal error");
  });
});

httpServer.on("error", (err: NodeJS.ErrnoException) => {
  console.error(
    err.code === "EADDRINUSE"
      ? `Port ${port} is in use — set DEVHUB_MCP_HTTP_PORT or stop the other listener.`
      : `DevHub MCP (HTTP) failed: ${err.message}`,
  );
  process.exit(1);
});

httpServer.listen(port, host, () => {
  const where = source === "env" ? "DEVHUB_MCP_HTTP_TOKEN" : tokenFile;
  console.error(`DevHub MCP (HTTP) on http://${host}:${port}/mcp — bearer token from ${where}`);
});

async function shutdown(): Promise<void> {
  await Promise.allSettled([...sessions.values()].map((transport) => transport.close()));
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_000).unref();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
