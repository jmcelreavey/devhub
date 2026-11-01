import { terminalPort } from "@devhub/core/local/terminal/port";
import { desktopTerminalTicket } from "../../../../../../../packages/shared/actions/desktop";
import {
  isAuthenticatedDesktopRequest,
  isDesktopSession,
  issueTerminalTicket,
} from "@devhub/core/local/terminal/bootstrap-auth";

/**
 * Mint a short-lived ticket for the terminal WebSocket.
 *
 * This exists because the browser cannot present the bootstrap cookie to the
 * PTY server: WKWebView does not attach it to a `ws://` handshake on a
 * different port. It *can* present it here — same origin, ordinary fetch — and
 * gets back something it is allowed to hold and pass along.
 *
 * In browser mode there is no desktop session, so this returns `null` and the
 * terminal connects with origin checking alone, exactly as it did before. That
 * keeps `npm run dev` working without a second auth path to maintain.
 */


export async function GET(req: Request) {
  return await desktopTerminalTicket.handler({}, { execute: () => ticket(req) }) as Response;
}

function ticket(req: Request) {
  const terminalUrl = process.env.TERMINAL_URL?.trim() || null;
  if (!isDesktopSession()) {
    return Response.json({ ticket: null, desktop: false, port: terminalPort(), terminalUrl });
  }
  if (!isAuthenticatedDesktopRequest(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({ ticket: issueTerminalTicket(), desktop: true, port: terminalPort(), terminalUrl });
}
