import { pluginOperation } from "../../../../../../../../packages/shared/actions/plugins";
import { assertPluginManagement, pluginError, pluginJson, serverPluginContext } from "../../../../../lib/plugins/http";
import { getOperation } from "../../../../../lib/plugins/operations";


export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    const { id } = pluginOperation.input.parse(await params);
    return pluginJson(pluginOperation.handler({ id }, { execute: ({ id }) => getOperation(serverPluginContext(), id) }));
  } catch (err) {
    return pluginError(err);
  }
}
