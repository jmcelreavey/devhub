import { NextResponse, type NextRequest } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { cancelConnection, closeConnection } from "@/lib/db/pool";
import { dbFailure, requireAuth, type ConnectionParams } from "../../_shared";

export const dynamic = "force-dynamic";

/**
 * Stop whatever this connection is running.
 *
 * `cancelled: false` is a real answer, not a failure — MongoDB has no
 * out-of-band cancel, and nothing may be running. The UI says so rather than
 * pretending the button worked.
 */
export const POST = withErrorHandler(async (req: NextRequest, { params }: ConnectionParams) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  const { id } = await params;
  try {
    const cancelled = await cancelConnection(id);
    return NextResponse.json({ cancelled });
  } catch (err) {
    return dbFailure(err);
  }
}, "db.cancel");

/** Close the connection outright — the rail's "disconnect". */
export const DELETE = withErrorHandler(async (req: NextRequest, { params }: ConnectionParams) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  const { id } = await params;
  await closeConnection(id);
  return NextResponse.json({ closed: true });
}, "db.close");
