import type { NextRequest } from "next/server";
import { assertPluginManagement, pluginError, pluginJson, readJson, serverPluginContext } from "@/lib/plugins/http";
import { invokeRuntime, loadRuntime } from "@/lib/plugins/runtime-host";
import { z } from "zod";

export const dynamic = "force-dynamic";
const requestSchema = z.object({
  kind: z.enum(["page", "api", "mcp"]), path: z.string().max(240),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]), body: z.unknown().optional(),
}).strict();
type Context = { params: Promise<{ name: string }> };

export async function GET(req: NextRequest, context: Context) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    const { name } = await context.params;
    return pluginJson(loadRuntime(serverPluginContext(), name).runtime);
  } catch (err) { return pluginError(err); }
}

export async function POST(req: NextRequest, context: Context) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    const parsed = requestSchema.safeParse(await readJson(req));
    if (!parsed.success) return pluginJson({ error: "Invalid runtime request" }, 400);
    const { name } = await context.params;
    const ctx = serverPluginContext();
    const runtime = loadRuntime(ctx, name).runtime;
    const streaming = parsed.data.kind === "api" && runtime.routes.some((route) => route.path === parsed.data.path && route.method === parsed.data.method && route.stream);
    if (!streaming) return pluginJson({ result: await invokeRuntime(ctx, name, parsed.data, req.signal) });
    const controller = new AbortController();
    const abort = () => controller.abort();
    req.signal.addEventListener("abort", abort, { once: true });
    if (req.signal.aborted) abort();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(output) {
        const send = (event: unknown) => { if (!controller.signal.aborted) output.enqueue(encoder.encode(JSON.stringify(event) + "\n")); };
        void invokeRuntime(ctx, name, parsed.data, controller.signal, send)
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
  } catch (err) { return pluginError(err); }
}
