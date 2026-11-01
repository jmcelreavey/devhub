import { pluginBrowserAction } from "../../../../../../../../../packages/shared/actions/plugins";
import { emitCoreEvent } from "@devhub/core/events/core-events";
import { assertPluginManagement, pluginError, pluginJson, readJson, serverPluginContext } from "../../../../../../lib/plugins/http";
import { authorizePageAction, createPageNote } from "../../../../../../lib/plugins/runtime-pages";

export async function POST(req: Request, context: { params: Promise<{ name: string }> }) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    const { name } = await context.params;
    const body = await readJson(req);
    const ctx = serverPluginContext();
    const { action } = authorizePageAction(ctx, name, body);
    const input = pluginBrowserAction.input.parse({ name, body, create: action.kind === "createNote" ? new URL(req.url).searchParams.get("create") : null });
    return await pluginBrowserAction.handler(input, { execute: async (selection) => {
    // Creation is a separate request after the host's explicit confirmation.
      if (action.kind === "createNote" && selection.create === "1") {
        const result = await createPageNote(ctx, selection.name, selection.body);
        emitCoreEvent("notes");
        return pluginJson(result, 201);
      }
      return pluginJson({ allowed: true });
    } }) as Response;
  } catch (error) { return pluginError(error); }
}
