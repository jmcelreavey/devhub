import { pluginThemes } from "../../../../../../../packages/shared/actions/plugins";
import { assertPluginManagement, pluginError, pluginJson, serverPluginContext } from "../../../../lib/plugins/http";
import { runtimeThemeSnapshot } from "../../../../lib/plugins/runtime-themes";

export function GET(req: Request) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    pluginThemes.input.parse({});
    return pluginJson(pluginThemes.handler({}, { execute: () => runtimeThemeSnapshot(serverPluginContext()) }));
  }
  catch (error) { return pluginError(error); }
}
