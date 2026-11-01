import { providerFor } from "../../../../../lib/integrations/registry";
import { assertPluginManagement, pluginError, pluginJson, readJson, serverPluginContext } from "../../../../../lib/plugins/http";
import { invokeRuntime, loadRuntime } from "../../../../../lib/plugins/runtime-host";
import { z } from "zod";
import { PluginApiError } from "../../../../../lib/plugins/context";
import { httpAction } from "../../../../../lib/actions/http";
import { pluginRuntimeRead } from "../../../../../../../../packages/shared/actions/plugins";
import {
  pluginActionList, pluginActionListInput, pluginActionReview, pluginActionReviewInput,
  pluginActionRun, pluginActionRunInput, pluginActionStatus, pluginActionStatusInput,
} from "../../../../../../../../packages/shared/actions/plugin-actions";

const requestSchema = z.object({
  kind: z.enum(["page", "api", "mcp"]), path: z.string().max(240),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]), body: z.unknown().optional(),
  revision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
type Context = { params: Promise<{ name: string }> };

export async function GET(req: Request, context: Context) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    const { name } = await context.params;
    const view = new URL(req.url).searchParams.get("view");
    return await pluginRuntimeRead.handler({ name, view }, { execute: (input) => {
      const plugin = loadRuntime(serverPluginContext(), input.name);
      return pluginJson(input.view === "page" ? { runtime: plugin.runtime, revision: plugin.revision } : plugin.runtime);
    } }) as Response;
  } catch (err) { return pluginError(err); }
}

export async function POST(req: Request, context: Context) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    const parsed = requestSchema.safeParse(await readJson(req));
    if (!parsed.success) return pluginJson({ error: "Invalid runtime request" }, 400);
    const { name } = await context.params;
    const ctx = serverPluginContext();
    const loaded = loadRuntime(ctx, name);
    const runtime = loaded.runtime;
    const { revision, ...request } = parsed.data;
    if (revision && revision !== loaded.revision) throw new PluginApiError(409, "PAGE_CHANGED", "This plugin changed. Reload its page before continuing.");
    const execute = async (): Promise<Response> => {
      try {
        const streaming = request.kind === "api" && runtime.routes.some((route) => route.path === request.path && route.method === request.method && route.stream);
        if (!streaming) return pluginJson({ result: await invokeRuntime(ctx, name, request, req.signal, undefined, loaded.root, undefined, providerFor) });
        const controller = new AbortController();
        const abort = () => controller.abort();
        req.signal.addEventListener("abort", abort, { once: true });
        if (req.signal.aborted) abort();
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(output) {
            const send = (event: unknown) => { if (!controller.signal.aborted) output.enqueue(encoder.encode(JSON.stringify(event) + "\n")); };
            void invokeRuntime(ctx, name, request, controller.signal, send, loaded.root, undefined, providerFor)
              .then((result) => send({ type: "result", result }))
              .catch(() => send({ type: "error", error: "Plugin request failed. Check its status before retrying an action." }))
              .finally(() => {
                req.signal.removeEventListener("abort", abort);
                if (!controller.signal.aborted) output.close();
              });
          },
          cancel() { abort(); req.signal.removeEventListener("abort", abort); },
        });
        return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
      } catch (error) { return pluginError(error); }
    };
    const adapter = {
      context: () => ({ run: execute, refuse: () => pluginJson({ error: "Confirmation required" }, 403) }),
      response: (value: unknown) => value as Response,
    };
    const body = request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body as Record<string, unknown> : undefined;
    if (request.kind === "api" && request.method === "GET" && (request.path === "/actions" || request.path === "/runs")) {
      const input = { plugin: name, kind: request.path.slice(1) };
      if (pluginActionListInput.safeParse(input).success) return httpAction(pluginActionList, { ...adapter, input: () => input })(req);
    }
    if (request.kind === "api" && request.method === "POST" && request.path === "/actions/review") {
      const input = { plugin: name, input: request.body };
      if (pluginActionReviewInput.safeParse(input).success) return httpAction(pluginActionReview, { ...adapter, input: () => input })(req);
    }
    if (request.kind === "api" && request.method === "POST" && request.path === "/actions/execute") {
      const input = { plugin: name, token: body?.token, confirm: true };
      if (pluginActionRunInput.safeParse(input).success) return httpAction(pluginActionRun, { ...adapter, input: () => input })(req);
    }
    if (request.kind === "api" && request.method === "POST" && request.path === "/runs/status") {
      const input = { plugin: name, runId: body?.runId };
      if (pluginActionStatusInput.safeParse(input).success) return httpAction(pluginActionStatus, { ...adapter, input: () => input })(req);
    }
    return execute();
  } catch (err) { return pluginError(err); }
}
