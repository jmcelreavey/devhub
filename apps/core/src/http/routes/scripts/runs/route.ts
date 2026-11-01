import { scriptsRuns } from "../../../../../../../packages/shared/actions/scripts";
import { listRecentRuns } from "../../../../lib/runs/history";

/**
 * Recent run history, newest first, from the audit log that scripts-runner has
 * always written and nothing has ever read.
 *
 * Read-only and local — no mutating verbs here, so `proxy.ts` (which guards
 * mutating methods on /api/*) has nothing to do with it by design.
 */

export async function GET(req: Request) {
  const limitParam = new URL(req.url).searchParams.get("limit");
  const parsed = Number(limitParam);
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 100) : 25;
  const input = scriptsRuns.input.parse({ limit });
  return Response.json({ runs: scriptsRuns.handler(input, { read: listRecentRuns }) });
}
