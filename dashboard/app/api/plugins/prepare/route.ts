import { type NextRequest } from "next/server";
import { URL_MESSAGES } from "@/lib/plugins/github-url";
import { assertPluginManagement, pluginError, pluginJson, readJson, serverPluginContext } from "@/lib/plugins/http";
import { PluginApiError, startPrepare } from "@/lib/plugins/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
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
    const view = await startPrepare(serverPluginContext(), (body as { url: string }).url, req.headers.get("idempotency-key"));
    return pluginJson({
      operationId: view.id,
      state: view.state,
      statusUrl: `/api/plugins/operations/${view.id}`,
    }, 202);
  } catch (err) {
    return pluginError(err);
  }
}
