import type { NextRequest } from "next/server";
import { assertPluginManagement, pluginError, pluginJson, readJson, serverPluginContext } from "@/lib/plugins/http";
import { invokeRuntime } from "@/lib/plugins/runtime-host";
import { runtimeMcpAuthenticated } from "@/lib/plugins/runtime-mcp";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, context: { params: Promise<{ name: string; server: string }> }) {
  const { name, server } = await context.params;
  if (!runtimeMcpAuthenticated(req, name, server)) {
    const auth = assertPluginManagement(req);
    if (!auth.ok) return auth.response;
  }
  try {
    const body = await readJson(req);
    if (!body || typeof body !== "object" || Array.isArray(body) || !("jsonrpc" in body) || body.jsonrpc !== "2.0" || !("method" in body) || typeof body.method !== "string") return pluginJson({ error: "Invalid JSON-RPC request" }, 400);
    const result = await invokeRuntime(serverPluginContext(), name, { kind: "mcp", path: server, method: "POST", body }, req.signal);
    if (!("id" in body)) return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
    return pluginJson(result);
  } catch (err) { return pluginError(err); }
}
