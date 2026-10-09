import { type NextRequest } from "next/server";
import { assertPluginManagement, pluginError, pluginJson, serverPluginContext } from "@/lib/plugins/http";
import { listRegistrations, unfinishedOperations } from "@/lib/plugins/operations";
import { aliasHome, serviceRuntime, tildePath } from "@/lib/plugins/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    const ctx = serverPluginContext();
    const where = serviceRuntime(ctx.env);
    return pluginJson({
      ...listRegistrations(ctx),
      operations: unfinishedOperations(ctx),
      storageLine: where.storageLine,
      syncHeading: where.syncHeading,
      syncNote: where.syncNote,
      runtimeLabel: where.label,
      // Readable form for the person; the diagnostic copy uses the aliased form.
      settingsFile: tildePath(ctx.paths.registryPath, ctx.home),
      settingsFileAlias: aliasHome(ctx.paths.registryPath, ctx.home),
    });
  } catch (err) {
    return pluginError(err);
  }
}
