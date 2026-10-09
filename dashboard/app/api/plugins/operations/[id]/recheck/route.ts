import { type NextRequest } from "next/server";
import { assertPluginManagement, pluginError, pluginJson, serverPluginContext } from "@/lib/plugins/http";
import { recheckOperation } from "@/lib/plugins/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    return pluginJson(await recheckOperation(serverPluginContext(), id));
  } catch (err) {
    return pluginError(err);
  }
}
