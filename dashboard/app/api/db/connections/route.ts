import { NextResponse, type NextRequest } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { invalidateDbConnections, listDbConnections } from "@/lib/db/registry";
import { closeAllConnections, listOpenConnections } from "@/lib/db/pool";
import { requireAuth } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * Every connection this machine could open.
 *
 * Cheap by contract — providers must not shell out here — because the rail
 * refetches it. Provider failures come back in `errors` rather than as a 500:
 * the BI plugin being unable to reach GitHub should not hide the local SQLite
 * files.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  const refresh = new URL(req.url).searchParams.get("refresh") === "true";
  const { connections, errors } = await listDbConnections({ refresh });
  const open = new Set(listOpenConnections().map((c) => c.connectionId));

  return NextResponse.json({
    connections: connections.map((c) => ({ ...c, open: open.has(c.id) })),
    errors,
  });
}, "db.connections");

/**
 * Drop cached listings and every open connection.
 *
 * Called after an AWS profile switch: connections are derived from access, so
 * when the access changes the list is stale and the pooled sockets are
 * authenticated as somebody else.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  invalidateDbConnections();
  await closeAllConnections();
  const { connections, errors } = await listDbConnections({ refresh: true });
  return NextResponse.json({ connections, errors, reset: true });
}, "db.connections.reset");
