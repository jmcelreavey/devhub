import { pluginOperationDiagnostics } from "../../../../../../../../../packages/shared/actions/plugins";
import { assertPluginManagement, pluginError, pluginJson, serverPluginContext } from "../../../../../../lib/plugins/http";
import { diagnosticsFor } from "../../../../../../lib/plugins/operations";


export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    const { id } = pluginOperationDiagnostics.input.parse(await params);
    return pluginJson(await pluginOperationDiagnostics.handler({ id }, { execute: ({ id }) => diagnosticsFor(serverPluginContext(), id) }));
  } catch (err) {
    return pluginError(err);
  }
}
