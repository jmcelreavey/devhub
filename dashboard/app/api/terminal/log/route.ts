import { readFile } from "node:fs/promises";
import { NextResponse, type NextRequest } from "next/server";
import { cleanTerminalOutput, isValidSessionId, terminalLogPath } from "@/lib/terminal-log";

export const dynamic = "force-dynamic";

/**
 * Returns a terminal session's full output as clean plain text. The PTY peer
 * tees every session to a log file on disk; this reads it back so the dashboard
 * can "copy all output" without the browser scrollback cap.
 */
export const GET = async (req: NextRequest) => {
  const sessionId = req.nextUrl.searchParams.get("session") ?? "";
  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: "invalid or missing session id" }, { status: 400 });
  }
  const file = terminalLogPath(sessionId);
  if (!file) {
    return NextResponse.json({ error: "invalid session id" }, { status: 400 });
  }
  try {
    const raw = await readFile(file, "utf8");
    return new NextResponse(cleanTerminalOutput(raw), {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "session log not found" }, { status: 404 });
    }
    console.error("[api:terminal/log]", err);
    return NextResponse.json({ error: "could not read session log" }, { status: 500 });
  }
};
