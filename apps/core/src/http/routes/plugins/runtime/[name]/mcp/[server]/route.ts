import { pluginRuntimeMcp } from "../../../../../../../../../../packages/shared/actions/plugins";
import { assertPluginManagement, pluginError, pluginJson, readJson, serverPluginContext } from "../../../../../../../lib/plugins/http";
import { invokeRuntime, loadRuntime } from "../../../../../../../lib/plugins/runtime-host";
import { runtimeMcpAuthenticated } from "../../../../../../../lib/plugins/runtime-mcp";


export async function POST(req: Request, context: { params: Promise<{ name: string; server: string }> }) {
  const { name, server } = await context.params;
  if (!runtimeMcpAuthenticated(req, name, server)) {
    const auth = assertPluginManagement(req);
    if (!auth.ok) return auth.response;
  }
  try {
    const body = await readJson(req);
    if (!body || typeof body !== "object" || Array.isArray(body) || !("jsonrpc" in body) || body.jsonrpc !== "2.0" || !("method" in body) || typeof body.method !== "string") return pluginJson({ error: "Invalid JSON-RPC request" }, 400);
    const input = pluginRuntimeMcp.input.parse({ name, server, body });
    return await pluginRuntimeMcp.handler(input, { execute: async (selection) => {
      const requestBody = selection.body as typeof body;
      const ctx = serverPluginContext();
      const revision = req.headers.get("x-devhub-plugin-revision");
      const loaded = revision ? loadRuntime(ctx, selection.name) : undefined;
      if (revision && (!/^[a-f0-9]{64}$/.test(revision) || loaded?.revision !== revision)) return pluginJson({ error: "The runtime plugin changed. Review it before continuing." }, 409);
      const result = await invokeRuntime(ctx, selection.name, { kind: "mcp", path: selection.server, method: "POST", body: requestBody }, req.signal, undefined, loaded?.root, revision ?? undefined);
      if (!("id" in requestBody)) return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
      return pluginJson(result);
    } }) as Response;
  } catch (err) { return pluginError(err); }
}
