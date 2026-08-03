import { NextResponse } from "next/server";
import { getSessionTranscript } from "@/lib/terminal-search";
import { isValidSessionId } from "@/lib/terminal-log";

export const dynamic = "force-dynamic";

/**
 * Historical session transcript for the read-only viewer.
 *
 * Same cleaned tail + 1-based line indexing as `/api/terminal/search`, with
 * secrets redacted. Live dock "copy all" still uses `/api/terminal/log`
 * (full file, unredacted) — this route is for browsing closed sessions.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session") ?? "";
  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: "invalid or missing session id" }, { status: 400 });
  }
  const transcript = getSessionTranscript(sessionId);
  if (!transcript) {
    return NextResponse.json({ error: "session log not found" }, { status: 404 });
  }
  return NextResponse.json(transcript, {
    headers: { "cache-control": "no-store" },
  });
}
