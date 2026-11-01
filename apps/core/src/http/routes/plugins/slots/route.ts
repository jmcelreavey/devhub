import { pluginSlotInvoke, pluginSlots } from "../../../../../../../packages/shared/actions/plugins";
import { assertPluginManagement, pluginError, pluginJson, readJson, serverPluginContext } from "../../../../lib/plugins/http";
import { invokeRuntimeSlot, runtimeSlots } from "../../../../lib/plugins/runtime-slots";


export async function GET(req: Request) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  const location = new URL(req.url).searchParams.get("location");
  if (location !== "repo" && location !== "task" && location !== "setup") return pluginJson({ error: "Invalid slot location" }, 400);
  try {
    const input = pluginSlots.input.parse({ location });
    return pluginJson(pluginSlots.handler(input, { execute: ({ location }) => ({ slots: runtimeSlots(serverPluginContext(), location) }) }));
  }
  catch (error) { return pluginError(error); }
}

export async function POST(req: Request) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    const ctx = serverPluginContext();
    const input = pluginSlotInvoke.input.parse({ body: await readJson(req) });
    return pluginJson(await pluginSlotInvoke.handler(input, { execute: async ({ body }) => ({ result: await invokeRuntimeSlot(ctx, body, req.signal) }) }));
  }
  catch (error) { return pluginError(error); }
}
