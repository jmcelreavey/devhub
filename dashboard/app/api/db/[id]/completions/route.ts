import { NextResponse, type NextRequest } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { getCompletions } from "@/lib/db/completions";
import { dbFailure, requireAuth, withConnection, type ConnectionParams } from "../../_shared";

export const dynamic = "force-dynamic";

/**
 * Schemas, tables and columns for the editor's autocomplete.
 *
 * Separate from `/schema` because it answers a different question: the schema
 * tree wants objects with sizes and row counts, the editor wants every column
 * name and nothing else. Serving both from one payload would make the tree wait
 * on data it never renders.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: ConnectionParams) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  const { id } = await params;
  const resolved = await withConnection(id);
  if (!resolved.ok) return resolved.response;

  try {
    return NextResponse.json(await getCompletions(id));
  } catch (err) {
    return dbFailure(err);
  }
}, "db.completions");
