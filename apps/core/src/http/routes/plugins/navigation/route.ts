import { pluginNavigation } from "../../../../../../../packages/shared/actions/plugins";
import { assertPluginManagement, pluginError, pluginJson, serverPluginContext } from "../../../../lib/plugins/http";
import { runtimeNavigation } from "../../../../lib/plugins/runtime-nav";
import { resolveRuntimeAlias } from "../../../../lib/plugins/runtime-aliases";


export async function GET(req: Request) {
  try {
    const path = new URL(req.url).searchParams.get("alias");
    if (path !== null) {
      if (!path.startsWith("/") || path.startsWith("//") || path.includes("?") || path.includes("#")) {
        return pluginJson({ error: "Invalid alias" }, 400);
      }
      const resolved = resolveRuntimeAlias(serverPluginContext(), path, "GET");
      return pluginJson({ alias: resolved?.alias.kind === "page" ? { name: resolved.plugin.name, page: resolved.alias.target } : null });
    }
    const auth = assertPluginManagement(req);
    if (!auth.ok) return auth.response;
    pluginNavigation.input.parse({});
    return pluginJson(pluginNavigation.handler({}, { execute: () => runtimeNavigation(serverPluginContext()) }));
  }
  catch (error) { return pluginError(error); }
}
