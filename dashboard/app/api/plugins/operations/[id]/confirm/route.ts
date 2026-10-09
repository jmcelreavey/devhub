import { type NextRequest } from "next/server";
import { assertPluginManagement, pluginError, pluginJson, readJson, serverPluginContext } from "@/lib/plugins/http";
import { PluginApiError, confirmOperation } from "@/lib/plugins/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const body = await readJson(req);
    if (!body || typeof body !== "object") throw new PluginApiError(400, "INVALID_BODY", "Review the plugin before enabling it.", false, id);
    const record = body as { revision?: unknown; planDigest?: unknown; selectedTargets?: unknown; accepted?: unknown };
    if (typeof record.revision !== "number" || typeof record.planDigest !== "string" || !Array.isArray(record.selectedTargets)) {
      throw new PluginApiError(400, "INVALID_BODY", "Review the plugin before enabling it.", false, id);
    }
    const view = await confirmOperation(serverPluginContext(), id, {
      revision: record.revision,
      planDigest: record.planDigest,
      selectedTargets: record.selectedTargets.filter((item): item is string => typeof item === "string"),
      accepted: record.accepted === true,
    }, req.headers.get("idempotency-key"));
    return pluginJson(view);
  } catch (err) {
    return pluginError(err);
  }
}
