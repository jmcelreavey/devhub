import { type NextRequest } from "next/server";
import { assertPluginManagement, pluginError, pluginJson, serverPluginContext } from "@/lib/plugins/http";
import { startLifecycle } from "@/lib/plugins/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const view = await startLifecycle(serverPluginContext(), id, "remove");
    return pluginJson({ operationId: view.id, state: view.state, statusUrl: `/api/plugins/operations/${view.id}` }, 202);
  } catch (err) {
    return pluginError(err);
  }
}
