import { readFile } from "node:fs/promises";
import { terminalTail } from "../../../../../../../packages/shared/actions/terminal";
import { httpAction } from "../../../../lib/actions/http";
import { cleanTerminalOutput } from "../../../../../../../packages/shared/terminal/ansi";
import { isValidSessionId, terminalLogPath } from "../../../../local/terminal/log";


/**
 * Returns a terminal session's full output as clean plain text. The PTY peer
 * tees every session to a log file on disk; this reads it back so the dashboard
 * can "copy all output" without the browser scrollback cap.
 */
export const GET = httpAction(terminalTail, {
  input: (req) => ({ sessionId: new URL(req.url).searchParams.get("session") ?? "" }),
  context: () => ({
    read: async (sessionId) => {
      if (!isValidSessionId(sessionId)) return { status: 400, body: { error: "invalid or missing session id" } };
      const file = terminalLogPath(sessionId);
      if (!file) return { status: 400, body: { error: "invalid session id" } };
      try {
        return { status: 200, body: cleanTerminalOutput(await readFile(file, "utf8")) };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return { status: 404, body: { error: "session log not found" } };
        console.error("[api:terminal/log]", err);
        return { status: 500, body: { error: "could not read session log" } };
      }
    },
  }),
  response: ({ status, body }) => typeof body === "string"
    ? new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } })
    : Response.json(body, { status }),
});
