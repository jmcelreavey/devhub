import { NextResponse } from "next/server";
import { listRecentRuns } from "@/lib/run-history";

/**
 * Recent run history, newest first, from the audit log that scripts-runner has
 * always written and nothing has ever read.
 *
 * Read-only and local — no mutating verbs here, so `proxy.ts` (which guards
 * mutating methods on /api/*) has nothing to do with it by design.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limitParam = new URL(req.url).searchParams.get("limit");
  const parsed = Number(limitParam);
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 100) : 25;
  return NextResponse.json({ runs: listRecentRuns(limit) });
}
