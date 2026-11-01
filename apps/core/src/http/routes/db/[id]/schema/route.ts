import { withErrorHandler } from "../../../../../lib/api-utils";
import { describeSchema } from "../../../../../lib/db/introspect";
import { dbFailure, requireAuth, withConnection, type ConnectionParams } from "../../_shared";
import { httpAction } from "../../../../../lib/actions/http";
import { dbSchema } from "../../../../../../../../packages/shared/actions/db";


/** Namespaces plus their tables/collections — what the schema tree renders. */
export const GET = withErrorHandler(async (req: Request, { params }: ConnectionParams) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  const { id } = await params;
  const resolved = await withConnection(id);
  if (!resolved.ok) return resolved.response;

  const namespace = new URL(req.url).searchParams.get("namespace") ?? undefined;

  return httpAction(dbSchema, {
    input: () => ({ connectionId: id, namespace }),
    context: () => ({ run: async (input) => {
      try { return Response.json(await describeSchema(input.connectionId, input.namespace)); }
      catch (error) { return dbFailure(error); }
    } }),
    response: (result) => result as Response,
  })(req);
}, "db.schema");
