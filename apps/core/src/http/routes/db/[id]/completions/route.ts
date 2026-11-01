import { withErrorHandler } from "../../../../../lib/api-utils";
import { getCompletions } from "../../../../../lib/db/completions";
import { dbCompletions } from "../../../../../../../../packages/shared/actions/db";
import { dbFailure, requireAuth, withConnection, type ConnectionParams } from "../../_shared";


/**
 * Schemas, tables and columns for the editor's autocomplete.
 *
 * Separate from `/schema` because it answers a different question: the schema
 * tree wants objects with sizes and row counts, the editor wants every column
 * name and nothing else. Serving both from one payload would make the tree wait
 * on data it never renders.
 */
export const GET = withErrorHandler(async (req: Request, { params }: ConnectionParams) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  const { id } = await params;
  const resolved = await withConnection(id);
  if (!resolved.ok) return resolved.response;

  return await dbCompletions.handler(dbCompletions.input.parse({ connectionId: id }), { run: async ({ connectionId }) => {
      try { return Response.json(await getCompletions(connectionId)); }
      catch (err) { return dbFailure(err); }
    } }) as Response;
}, "db.completions");
