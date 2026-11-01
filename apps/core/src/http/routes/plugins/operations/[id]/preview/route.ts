import { pluginOperationPreview } from "../../../../../../../../../packages/shared/actions/plugins";
import { assertPluginManagement, pluginError, pluginJson, serverPluginContext } from "../../../../../../lib/plugins/http";
import { getPreview } from "../../../../../../lib/plugins/operations";


export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    const { id } = pluginOperationPreview.input.parse(await params);
    return pluginJson(pluginOperationPreview.handler({ id }, { execute: ({ id }) => getPreview(serverPluginContext(), id) }));
  } catch (err) {
    return pluginError(err);
  }
}
