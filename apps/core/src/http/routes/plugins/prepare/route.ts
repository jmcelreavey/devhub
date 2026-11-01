import { pluginPrepare } from "../../../../../../../packages/shared/actions/plugins";
import { URL_MESSAGES } from "../../../../../../../packages/shared/ui-lib/plugins/github-url";
import { assertPluginManagement, pluginError, pluginJson, readJson, serverPluginContext } from "../../../../lib/plugins/http";
import { PluginApiError, startPrepare } from "../../../../lib/plugins/operations";


export async function POST(req: Request) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    const body = await readJson(req);
    if (!body || typeof body !== "object" || typeof (body as { url?: unknown }).url !== "string") {
      throw new PluginApiError(400, "INVALID_URL", URL_MESSAGES.empty);
    }
    if ("ref" in (body as object)) {
      throw new PluginApiError(400, "REF_UNSUPPORTED", URL_MESSAGES.refUnsupported);
    }
    const input = pluginPrepare.input.parse({ url: (body as { url: string }).url, idempotencyKey: req.headers.get("idempotency-key") });
    const view = await pluginPrepare.handler(input, { execute: ({ url, idempotencyKey }) => startPrepare(serverPluginContext(), url, idempotencyKey) }) as Awaited<ReturnType<typeof startPrepare>>;
    return pluginJson({
      operationId: view.id,
      state: view.state,
      statusUrl: `/api/plugins/operations/${view.id}`,
    }, 202);
  } catch (err) {
    return pluginError(err);
  }
}
