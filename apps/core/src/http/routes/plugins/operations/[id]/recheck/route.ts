import { pluginOperationRecheck } from "../../../../../../../../../packages/shared/actions/plugins";
import { assertPluginManagement, pluginError, pluginJson, serverPluginContext } from "../../../../../../lib/plugins/http";
import { recheckOperation } from "../../../../../../lib/plugins/operations";


export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    const { id } = pluginOperationRecheck.input.parse(await params);
    return pluginJson(await pluginOperationRecheck.handler({ id }, { execute: ({ id }) => recheckOperation(serverPluginContext(), id) }));
  } catch (err) {
    return pluginError(err);
  }
}
