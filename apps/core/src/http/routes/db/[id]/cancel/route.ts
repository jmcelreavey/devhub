import { withErrorHandler } from "../../../../../lib/api-utils";
import { cancelConnection, closeConnection } from "../../../../../lib/db/pool";
import { dbFailure, requireAuth, type ConnectionParams } from "../../_shared";
import { httpAction } from "../../../../../lib/actions/http";
import { dbCancel, dbClose } from "../../../../../../../../packages/shared/actions/db";


/**
 * Stop whatever this connection is running.
 *
 * `cancelled: false` is a real answer, not a failure — MongoDB has no
 * out-of-band cancel, and nothing may be running. The UI says so rather than
 * pretending the button worked.
 */
export const POST = withErrorHandler(async (req: Request, { params }: ConnectionParams) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  const { id } = await params;
  return httpAction(dbCancel, {
    input: () => ({ connectionId: id }),
    context: () => ({ run: async ({ connectionId }) => {
      try { return Response.json({ cancelled: await cancelConnection(connectionId) }); }
      catch (error) { return dbFailure(error); }
    } }),
    response: (result) => result as Response,
  })(req);
}, "db.cancel");

/** Close the connection outright — the rail's "disconnect". */
export const DELETE = withErrorHandler(async (req: Request, { params }: ConnectionParams) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  const { id } = await params;
  return await dbClose.handler({ connectionId: id }, { run: async ({ connectionId }) => {
    await closeConnection(connectionId);
    return Response.json({ closed: true });
  } }) as Response;
}, "db.close");
