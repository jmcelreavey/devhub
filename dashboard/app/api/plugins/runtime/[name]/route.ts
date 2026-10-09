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
    return pluginJson({ result: await invokeRuntime(serverPluginContext(), name, parsed.data, req.signal) });
  } catch (err) { return pluginError(err); }
}
