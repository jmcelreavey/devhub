import { withErrorHandler } from "../../../../../lib/api-utils";
import { preflightDbConnection } from "../../../../../lib/db/registry";
import { dbFailure, requireAuth, type ConnectionParams } from "../../_shared";
import { httpAction } from "../../../../../lib/actions/http";
import { dbPreflight } from "../../../../../../../../packages/shared/actions/db";


/**
 * Machine-level readiness before we try to open a socket.
 *
 * Deliberately not gated on `withConnection`: a connection marked unavailable
 * is exactly the one you want to run a preflight against, because the preflight
 * is what explains why.
 */
export const GET = withErrorHandler(async (req: Request, { params }: ConnectionParams) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  const { id } = await params;
  const requestedAccessMode = new URL(req.url).searchParams.get("accessMode");
  const accessMode = requestedAccessMode === "write" ? "write" : "read";
  return httpAction(dbPreflight, {
    input: () => ({ connectionId: id }),
    context: () => ({ run: async ({ connectionId }) => {
      try { return Response.json(await preflightDbConnection(connectionId, { accessMode })); }
      catch (error) { return dbFailure(error); }
    } }),
    response: (result) => result as Response,
  })(req);
}, "db.preflight");
