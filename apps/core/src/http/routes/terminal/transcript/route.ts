import { httpAction } from "../../../../lib/actions/http";
import { terminalTranscript } from "../../../../../../../packages/shared/actions/terminal";
import { getSessionTranscript } from "../../../../local/terminal/search";
import { isValidSessionId } from "../../../../local/terminal/log";


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
  return httpAction(terminalTranscript, {
    input: () => ({ session: sessionId }),
    context: () => ({ read: (session) => {
      if (!isValidSessionId(session)) return { status: 400, body: { error: "invalid or missing session id" } };
      const transcript = getSessionTranscript(session);
      if (!transcript) return { status: 404, body: { error: "session log not found" } };
      return { status: 200, body: transcript };
    } }),
    response: ({ status, body }) => Response.json(body, status === 200
      ? { status, headers: { "cache-control": "no-store" } }
      : { status }),
  })(req);
}
