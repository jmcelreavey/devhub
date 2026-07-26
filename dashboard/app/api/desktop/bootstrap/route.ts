import { NextRequest, NextResponse } from "next/server";
import {
  desktopCookieOptions,
  isDesktopSession,
  tokenMatches,
} from "@/lib/desktop/bootstrap-auth";

/**
 * One-shot token → cookie exchange. The only URL the shell loads directly.
 *
 * The redirect is the point. A token in the address bar ends up in history, in
 * `Referer` headers on the first outbound link, and in any screenshot the user
 * pastes into a bug report. Exchanging it immediately for an `HttpOnly` cookie
 * and redirecting to a clean URL means the secret exists in exactly one request.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isDesktopSession()) {
    // Browser mode has no shell and no token; there is nothing to bootstrap.
    return NextResponse.json({ error: "Not running in the desktop app" }, { status: 404 });
  }

  const token = req.nextUrl.searchParams.get("token");
  if (!tokenMatches(token)) {
    // Deliberately terse and deliberately slow to be useful: no hint about
    // length, no hint about how close the guess was.
    return NextResponse.json({ error: "Invalid bootstrap token" }, { status: 403 });
  }

  const target = new URL(req.nextUrl.searchParams.get("next") ?? "/", req.nextUrl.origin);
  // Only same-origin redirects. Without this, `?next=https://evil.example`
  // turns the bootstrap route into an open redirect that arrives with the
  // user's freshly minted cookie.
  const destination =
    target.origin === req.nextUrl.origin ? `${target.pathname}${target.search}` : "/";

  const response = NextResponse.redirect(new URL(destination, req.nextUrl.origin), 303);
  response.cookies.set(desktopCookieOptions().name, token!, desktopCookieOptions());
  return response;
}
