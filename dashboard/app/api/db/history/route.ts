import { NextResponse, type NextRequest } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { clearDbHistory, historyForDisplay, queryDbHistory } from "@/lib/db/history";
import { requireAuth } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * Recent queries, newest first.
 *
 * Statements come back summarised — one line, length-capped, credential-free —
 * because this feeds a list. The History tab fetches the full text for the one
 * entry the user opens.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const full = url.searchParams.get("full") === "true";
  const entries = queryDbHistory({
    connectionId: url.searchParams.get("connectionId") ?? undefined,
    search: url.searchParams.get("q") ?? undefined,
    limit: Number(url.searchParams.get("limit")) || undefined,
  });

  return NextResponse.json({ entries: full ? entries : historyForDisplay(entries) });
}, "db.history");

export const DELETE = withErrorHandler(async (req: NextRequest) => {
  const denied = requireAuth(req);
  if (denied) return denied;

  clearDbHistory();
  return NextResponse.json({ cleared: true });
}, "db.history.clear");
