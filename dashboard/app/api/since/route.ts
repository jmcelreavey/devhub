import { NextResponse } from "next/server";
import { buildAwayDigest } from "@/lib/since-last-visit";

/**
 * What happened since `ts` (epoch ms). Read-only.
 *
 * The client owns the timestamp — it's a per-browser UI preference, not shared
 * state. A missing or unparseable value defaults to 12 hours, which covers the
 * overnight case this exists for.
 */
export const dynamic = "force-dynamic";

const DEFAULT_WINDOW_MS = 12 * 60 * 60 * 1000;

export async function GET(req: Request) {
  const raw = Number(new URL(req.url).searchParams.get("ts"));
  const since = Number.isFinite(raw) && raw > 0 ? raw : Date.now() - DEFAULT_WINDOW_MS;
  return NextResponse.json(buildAwayDigest(since));
}
