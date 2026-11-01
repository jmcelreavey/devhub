import { providerFor } from "../../../../../lib/integrations/registry";
import { setupDatadogFormCheck, setupDatadogSavedCheck } from "../../../../../../../../packages/shared/actions/setup";
import { z } from "zod";
import { assertPluginManagement, pluginError, pluginJson, readJson, serverPluginContext } from "../../../../../lib/plugins/http";
import { PluginApiError } from "../../../../../lib/plugins/context";
import { invokeRuntime, runtimeCatalog } from "../../../../../lib/plugins/runtime-host";
import { redactRuntimeSecrets, runtimeResponse } from "../../../../../lib/plugins/runtime-response";

const inputSchema = z.object({ apiKey: z.string().max(200).optional(), applicationKey: z.string().max(200).optional() }).strip();
const responseSchema = z.object({ status: z.number().int().min(200).max(599), body: z.object({ ok: z.boolean(), code: z.string().max(100), message: z.string().max(2000) }).strict() }).strict();
const unavailable = () => pluginJson({ ok: false, code: "plugin_unavailable", message: "The Datadog runtime provider is unavailable." }, 503);

async function check(req: Request) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    const input = inputSchema.safeParse(req.method === "POST" ? await readJson(req) : {});
    if (!input.success) return pluginJson({ error: "Invalid Datadog check." }, 400);
    const action = req.method === "POST" ? setupDatadogFormCheck : setupDatadogSavedCheck;
    return await action.handler({ body: input.data }, {
      execute: ({ body }) => checkProvider(req, body as typeof input.data),
    }) as Response;
  } catch (error) { return error instanceof PluginApiError && error.status < 500 ? pluginError(error) : unavailable(); }
}

async function checkProvider(req: Request, input: ReturnType<typeof inputSchema.parse>) {
  const ctx = serverPluginContext();
  const owners = runtimeCatalog(ctx).filter(plugin => plugin.runtime.capabilities?.integrations?.some(provider => provider.id === "datadog") &&
    plugin.runtime.routes.some(route => route.path === "/api/setup/check/datadog" && route.method === req.method && !route.stream));
  if (owners.length !== 1) return unavailable();
  const plugin = owners[0];
  const result = await invokeRuntime(ctx, plugin.name, { kind: "api", path: "/api/setup/check/datadog", method: req.method, body: { query: {}, ...(req.method === "POST" ? { body: input } : {}) } }, req.signal, undefined, plugin.root, undefined, providerFor);
  const safe = runtimeResponse(responseSchema, result, plugin, ctx);
  const secrets = [input.apiKey?.trim(), input.applicationKey?.trim()].filter((value): value is string => !!value);
  return pluginJson(redactRuntimeSecrets(safe.body, secrets), safe.status);
}

export const GET = check;
export const POST = check;
