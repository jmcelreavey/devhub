import { pluginRegistration } from "../../../../../../../packages/shared/actions/plugins";
import { assertPluginManagement, pluginError, pluginJson, serverPluginContext } from "../../../../lib/plugins/http";
import { getRegistration } from "../../../../lib/plugins/operations";


export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    const { id } = pluginRegistration.input.parse(await params);
    return pluginJson(pluginRegistration.handler({ id }, { execute: ({ id }) => getRegistration(serverPluginContext(), id) }));
  } catch (err) {
    return pluginError(err);
  }
}
