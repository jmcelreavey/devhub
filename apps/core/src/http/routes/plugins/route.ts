import { pluginRegistrations } from "../../../../../../packages/shared/actions/plugins";
import { assertPluginManagement, pluginError, pluginJson, serverPluginContext } from "../../../lib/plugins/http";
import { listRegistrations, unfinishedOperations } from "../../../lib/plugins/operations";
import { aliasHome, serviceRuntime, tildePath } from "../../../lib/plugins/runtime";
import { runtimeCatalog } from "../../../lib/plugins/runtime-catalog";


export async function GET(req: Request) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    return await pluginRegistrations.handler(pluginRegistrations.input.parse({}), { execute: readRegistrations }) as Response;
  } catch (err) {
    return pluginError(err);
  }
}

function readRegistrations() {
  const ctx = serverPluginContext();
  const where = serviceRuntime(ctx.env);
  const registrations = listRegistrations(ctx);
  const trusted = new Set(runtimeCatalog(ctx).map((plugin) => plugin.id));
  return pluginJson({
    ...registrations,
    plugins: registrations.plugins.map((plugin) => ({ ...plugin, runtimeTrusted: trusted.has(plugin.id) })),
    operations: unfinishedOperations(ctx),
    storageLine: where.storageLine,
    syncHeading: where.syncHeading,
    syncNote: where.syncNote,
    runtimeLabel: where.label,
      // Readable form for the person; the diagnostic copy uses the aliased form.
    settingsFile: tildePath(ctx.paths.registryPath, ctx.home),
    settingsFileAlias: aliasHome(ctx.paths.registryPath, ctx.home),
  });
}
