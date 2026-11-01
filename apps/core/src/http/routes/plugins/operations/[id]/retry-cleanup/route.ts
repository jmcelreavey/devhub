import { pluginOperationRetryCleanup } from "../../../../../../../../../packages/shared/actions/plugins";
import { assertPluginManagement, pluginError, pluginJson, serverPluginContext } from "../../../../../../lib/plugins/http";
import { retryCleanup } from "../../../../../../lib/plugins/operations";


export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = assertPluginManagement(req);
  if (!auth.ok) return auth.response;
  try {
    const { id } = pluginOperationRetryCleanup.input.parse(await params);
    return pluginJson(await pluginOperationRetryCleanup.handler({ id }, { execute: ({ id }) => retryCleanup(serverPluginContext(), id) }));
  } catch (err) { return pluginError(err); }
}
