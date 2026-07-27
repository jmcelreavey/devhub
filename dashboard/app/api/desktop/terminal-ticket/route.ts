import { NextRequest, NextResponse } from "next/server";
import {
  isAuthenticatedDesktopRequest,
  isDesktopSession,
  issueTerminalTicket,
} from "@/lib/desktop/bootstrap-auth";

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
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isDesktopSession()) {
    return NextResponse.json({ ticket: null, desktop: false });
  }
  if (!isAuthenticatedDesktopRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ticket: issueTerminalTicket(), desktop: true });
}
