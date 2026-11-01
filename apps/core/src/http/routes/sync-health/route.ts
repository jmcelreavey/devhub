import { syncHealth } from "../../../../../../packages/shared/actions/misc-ui";
import { withErrorHandler } from "../../../lib/api-utils";
import { getRepoRoot } from "../../../lib/notes/dir";
import { collectSyncHealth } from "../../../lib/sync/health";


export const GET = withErrorHandler(async () => {
  return Response.json(await syncHealth.handler(syncHealth.input.parse({}), { execute: () => collectSyncHealth(getRepoRoot()) }));
}, "sync health");
