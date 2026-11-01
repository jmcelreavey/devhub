import { withErrorHandler } from "../../../../lib/api-utils";
import { clearDbHistory, historyForDisplay, queryDbHistory } from "../../../../lib/db/history";
import { requireAuth } from "../_shared";
import { httpAction } from "../../../../lib/actions/http";
import { dbHistory, dbHistoryClear } from "../../../../../../../packages/shared/actions/db";


/**
 * Recent queries, newest first.
 *
 * Statements come back summarised — one line, length-capped, credential-free —
 * because this feeds a list. The History tab fetches the full text for the one
 * entry the user opens.
 */
export const GET = withErrorHandler(async (req: Request) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const full = url.searchParams.get("full") === "true";
  const connectionId = url.searchParams.get("connectionId") ?? undefined;
  const query = url.searchParams.get("q") ?? undefined;
  const limit = Number(url.searchParams.get("limit")) || undefined;
  return httpAction(dbHistory, {
    input: () => ({ connectionId, q: query, limit: limit && Number.isInteger(limit) && limit > 0 && limit <= 200 ? limit : undefined }),
    context: () => ({ run: async () => {
      const entries = queryDbHistory({ connectionId, search: query, limit });
      return Response.json({ entries: full ? entries : historyForDisplay(entries) });
    } }),
    response: (result) => result as Response,
  })(req);
}, "db.history");

export const DELETE = withErrorHandler(async (req: Request) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  return await dbHistoryClear.handler({}, { run: async () => {
    clearDbHistory();
    return Response.json({ cleared: true });
  } }) as Response;
}, "db.history.clear");
