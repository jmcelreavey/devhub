import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { dashboardApiGuard } from "./auth";
import { routes } from "./routes.generated";
import { dispatchRoute, sortRoutes } from "./router";
import { serveStaticUi } from "./static-ui";
import { aliasIsReserved } from "../../../../packages/shared/ui-lib/plugins/alias-contract";
import { pluginError, serverPluginContext } from "../lib/plugins/http";
import { handleRuntimeAlias, resolveRuntimeAlias, reservedAliasNamespaces } from "../lib/plugins/runtime-aliases";
import { withRequestContext } from "../local/ops/context";
import type { LocalAgentHub } from "../local/ops/transport";

const orderedRoutes = sortRoutes(routes);

async function handleRequest(req: Request, rawTarget: string, uiDist?: string): Promise<Response> {
  const guard = dashboardApiGuard(req);
  if (guard.response) return guard.response;
  if (!guard.bypassAliases) {
    try {
      if (!aliasIsReserved(new URL(req.url).pathname, reservedAliasNamespaces())) {
        const resolved = resolveRuntimeAlias(serverPluginContext(), new URL(req.url).pathname, req.method);
        if (resolved?.alias.kind === "api") return await handleRuntimeAlias(req);
        if (resolved?.alias.kind === "page") {
          const target = new URL(req.url);
          target.pathname = `/plugins/runtime/${encodeURIComponent(resolved.plugin.name)}`;
          target.searchParams.set("page", resolved.alias.target);
          target.host = req.headers.get("host") ?? target.host;
          return new Response(null, { status: 307, headers: { Location: target.href, "Cache-Control": "no-store" } });
        }
      }
    } catch (error) {
      return pluginError(error);
    }
  }
  return await dispatchRoute(req, orderedRoutes)
    ?? await serveStaticUi(req, rawTarget, uiDist)
    ?? new Response("Not Found", { status: 404 });
}

function webRequest(incoming: IncomingMessage, signal: AbortSignal): Request {
  const target = incoming.url ?? "/";
  if (!target.startsWith("/") || target.startsWith("//")) throw new URIError("Invalid request target");
  const host = incoming.headers.host ?? "localhost:1337";
  let base: URL;
  try { base = new URL(`http://${host}`); } catch { throw new URIError("Invalid Host"); }
  if (base.username || base.password || base.pathname !== "/" || base.search || base.hash) throw new URIError("Invalid Host");
  const url = new URL(target, base);
  if (url.origin !== base.origin) throw new URIError("Invalid request target");
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  const method = incoming.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>;
  return new Request(url, { method, headers, body, signal, ...(body ? { duplex: "half" } : {}) } as RequestInit);
}

async function sendResponse(response: Response, outgoing: ServerResponse, head: boolean): Promise<void> {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") outgoing.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) outgoing.setHeader("set-cookie", cookies);
  if (!response.body || head) {
    if (response.body) await response.body.cancel();
    outgoing.end();
    return;
  }
  const stream = Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>);
  stream.on("error", error => outgoing.destroy(error));
  outgoing.on("close", () => stream.destroy());
  stream.pipe(outgoing);
}

export function createCoreServer(options: { uiDist?: string; localAgent?: { hub: LocalAgentHub; workspaceId: string } } = {}) {
  const server = createServer((incoming, outgoing) => {
    const controller = new AbortController();
    incoming.on("aborted", () => controller.abort());
    outgoing.on("close", () => controller.abort());
    void (async () => {
      try {
        const request = webRequest(incoming, controller.signal);
        const handle = () => handleRequest(request, incoming.url ?? "/", options.uiDist);
        const response = await (options.localAgent
          ? withRequestContext({ workspaceId: options.localAgent.workspaceId, localOps: options.localAgent.hub.ops }, handle)
          : handle());
        await sendResponse(response, outgoing, request.method === "HEAD");
      } catch (error) {
        if (outgoing.destroyed) return;
        if (outgoing.headersSent) {
          outgoing.destroy(error instanceof Error ? error : undefined);
          return;
        }
        if (error instanceof URIError) {
          outgoing.writeHead(400).end("Bad Request");
          return;
        }
        console.error("[core-http] request failed", error);
        outgoing.writeHead(500).end("Internal Server Error");
      }
    })();
  });
  options.localAgent?.hub.attach(server);
  return server;
}
