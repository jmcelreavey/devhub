import { NextResponse, type NextRequest } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { preflightDbConnection } from "@/lib/db/registry";
import { dbFailure, requireAuth, type ConnectionParams } from "../../_shared";

export const dynamic = "force-dynamic";

/**
 * Machine-level readiness before we try to open a socket.
 *
 * Deliberately not gated on `withConnection`: a connection marked unavailable
 * is exactly the one you want to run a preflight against, because the preflight
 * is what explains why.
 */
export const GET = withErrorHandler(async (req: NextRequest, { params }: ConnectionParams) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  const { id } = await params;
  const requestedAccessMode = req.nextUrl.searchParams.get("accessMode");
  const accessMode = requestedAccessMode === "write" ? "write" : "read";
  try {
    return NextResponse.json(await preflightDbConnection(id, { accessMode }));
  } catch (err) {
    return dbFailure(err);
  }
}, "db.preflight");
