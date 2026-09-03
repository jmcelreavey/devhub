import { NextResponse, type NextRequest } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { describeSchema } from "@/lib/db/introspect";
import { dbFailure, requireAuth, withConnection, type ConnectionParams } from "../../_shared";

export const dynamic = "force-dynamic";

/** Namespaces plus their tables/collections — what the schema tree renders. */
export const GET = withErrorHandler(async (req: NextRequest, { params }: ConnectionParams) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  const { id } = await params;
  const resolved = await withConnection(id);
  if (!resolved.ok) return resolved.response;

  const namespace = new URL(req.url).searchParams.get("namespace") ?? undefined;

  try {
    const schema = await describeSchema(id, namespace);
    return NextResponse.json(schema);
  } catch (err) {
    return dbFailure(err);
  }
}, "db.schema");
