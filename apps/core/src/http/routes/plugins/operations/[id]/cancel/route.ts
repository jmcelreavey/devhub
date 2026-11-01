import { pluginOperationCancel } from "../../../../../../../../../packages/shared/actions/plugins";
import { assertPluginManagement, pluginError, pluginJson, serverPluginContext } from "../../../../../../lib/plugins/http";
import { cancelOperation } from "../../../../../../lib/plugins/operations";


export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    const { id } = pluginOperationCancel.input.parse(await params);
    return pluginJson(await pluginOperationCancel.handler({ id }, { execute: ({ id }) => cancelOperation(serverPluginContext(), id) }));
  } catch (err) {
    return pluginError(err);
  }
}
