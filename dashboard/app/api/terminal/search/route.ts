import { NextResponse } from "next/server";
import { searchTerminalSessions } from "@/lib/terminal-search";

/**
 * Search recent terminal transcripts. Read-only.
 *
 * Every line returned has been through `redactSecrets` — see the module header
 * in lib/terminal-search.ts for why that is a precondition of this route
 * existing at all, not a nicety.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  if (q.trim().length < 2) {
    return NextResponse.json({ matches: [], sessionsSearched: 0, truncated: false });
  }
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200)
    : undefined;
  return NextResponse.json(searchTerminalSessions(q, limit));
}
