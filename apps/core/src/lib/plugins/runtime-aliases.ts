import { providerFor } from "../integrations/registry";
import { z } from "zod";
import { PluginApiError, type PluginContext } from "./context";
import { aliasIsReserved, matchAliasPath, type RuntimeAlias } from "../../../../../packages/shared/ui-lib/plugins/alias-contract";
import { loadRuntime, type LoadedRuntime } from "./runtime-host";
import { rows } from "./views";
import { readManifest } from "./manifest";
import { expandHome } from "./registry";
import { assertPluginManagement, pluginError, pluginJson, readJson, serverPluginContext } from "./http";
import { invokeRuntime } from "./runtime-host";
import { runtimeResponse } from "./runtime-response";

export function reservedAliasNamespaces(): string[] {
  // Tools/tests without a compiled ownership inventory cannot expose any aliases.
  if (!process.env.DEVHUB_CORE_ROUTE_NAMESPACES) return ["/*"];
  const parsed = z.array(z.string()).safeParse(JSON.parse(process.env.DEVHUB_CORE_ROUTE_NAMESPACES));
  if (!parsed.success || !parsed.data.length) throw new PluginApiError(503, "ALIAS_INVENTORY", "Core route ownership is unavailable.");
  return parsed.data;
}

export interface ResolvedAlias { plugin: LoadedRuntime; alias: RuntimeAlias }

const responseSchema = z.object({
  status: z.number().int().min(200).max(599).refine(status => ![204, 205, 304].includes(status)),
  body: z.unknown(),
  hostApproval: z.object({ proposalId: z.string(), status: z.literal("pending") }).strict().optional(),
}).strict();

/** Serve JSON aliases in the original request, retaining its origin and HTTP contract. */
export async function handleRuntimeAlias(req: Request, ctx = serverPluginContext()) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    const resolved = resolveRuntimeAlias(ctx, new URL(req.url).pathname, req.method);
    if (!resolved || resolved.alias.kind !== "api") throw new PluginApiError(404, "ALIAS_MISSING", "No reviewed HTTP alias is enabled here.");
    const { plugin, alias } = resolved;
    // URLSearchParams.get reads the first value; preserve that legacy query contract.
    const query = Object.fromEntries([...new Set(new URL(req.url).searchParams.keys())].map(key => [key, new URL(req.url).searchParams.get(key)!]));
    const params = matchAliasPath(alias.path, new URL(req.url).pathname);
    if (!params) throw new PluginApiError(404, "ALIAS_MISSING", "No reviewed HTTP alias is enabled here.");
    const body = req.method === "GET" ? undefined : await readJson(req, { allowEmpty: true });
    const approvalId = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).hostApprovalId : undefined;
    const envelope = { query, ...(Object.keys(params).length ? { params } : {}), ...(body === undefined ? {} : { body }), ...(approvalId === undefined ? {} : { hostApprovalId: approvalId }) };
    if (alias.preflight) {
      const preflight = runtimeResponse(responseSchema, await invokeRuntime(ctx, plugin.name, { kind: "api", path: alias.preflight, method: "GET", body: envelope }, req.signal, undefined, plugin.root, plugin.revision, providerFor), plugin, ctx);
      if (preflight.status !== 200) return pluginJson(preflight.body, preflight.status);
      const controller = new AbortController();
      const abort = () => controller.abort();
      req.signal.addEventListener("abort", abort, { once: true });
      if (req.signal.aborted) abort();
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(output) {
          const send = (text: string) => { if (!controller.signal.aborted) output.enqueue(encoder.encode(text)); };
          void invokeRuntime(ctx, plugin.name, { kind: "api", path: alias.target, method: "GET", body: envelope }, controller.signal, event => {
            if (event.type === "output") send(`data: ${JSON.stringify(event.text)}\n\n`);
          }, plugin.root, plugin.revision, providerFor).then(result => {
            const completed = runtimeResponse(z.object({ status: z.literal(200), body: z.object({ exitCode: z.number().int() }).strict() }).strict(), result, plugin, ctx);
            send(`event: done\ndata: ${completed.body.exitCode}\n\n`);
          }).catch(() => send("event: error\ndata: \"Plugin stream failed. Check the run status.\"\n\n")).finally(() => {
            req.signal.removeEventListener("abort", abort);
            if (!controller.signal.aborted) output.close();
          });
        },
        cancel() { controller.abort(); req.signal.removeEventListener("abort", abort); },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
    }
    const result = await invokeRuntime(ctx, plugin.name, { kind: "api", path: alias.target, method: req.method, body: envelope }, req.signal, undefined, plugin.root, plugin.revision, providerFor);
    const response = runtimeResponse(responseSchema, result, plugin, ctx);
    if (response.hostApproval) {
      if (!response.body || typeof response.body !== "object" || Array.isArray(response.body) || Object.hasOwn(response.body, "hostApproval")) throw new Error("Invalid alias approval response");
      return pluginJson({ ...response.body, hostApproval: response.hostApproval }, response.status);
    }
    return pluginJson(response.body, response.status);
  } catch (error) { return pluginError(error); }
}

/** Disabled owners still reserve their URLs. */
export function resolveRuntimeAlias(ctx: PluginContext, path: string, method: string, namespaces = reservedAliasNamespaces()): ResolvedAlias | null {
  if (aliasIsReserved(path, namespaces)) return null;
  const managed = rows(ctx).filter(row => row.managed);
  const claims = managed.flatMap(row => {
    const manifest = readManifest(expandHome(row.path, ctx.home));
    if (!manifest.ok) return [];
    return (manifest.manifest.runtime?.aliases ?? []).filter(alias => matchAliasPath(alias.path, path) !== null).map(alias => ({ row, alias }));
  });
  if (!claims.length) return null;
  if (new Set(claims.map(claim => `${claim.row.id}:${claim.row.name}:${claim.row.path}`)).size !== 1) throw new PluginApiError(409, "ALIAS_COLLISION", "More than one plugin claims this URL. Review their aliases in Plugins.");
  const claim = claims.find(({ alias }) => (alias.kind === "page" ? "GET" : alias.method) === method);
  if (!claim) throw new PluginApiError(405, "ALIAS_METHOD", "This method was not declared for this URL.");
  const plugin = loadRuntime(ctx, claim.row.name);
  const alias = plugin.runtime.aliases?.find(alias => alias.path === claim.alias.path && alias.kind === claim.alias.kind && alias.target === claim.alias.target && (alias.kind === "page" ? "GET" : alias.method) === method);
  if (!alias) throw new PluginApiError(409, "ALIAS_CHANGED", "This plugin changed. Reload its page before continuing.");
  return { plugin, alias };
}
