import {
  desktopCookieOptions,
  isDesktopSession,
  tokenMatches,
} from "@devhub/core/local/terminal/bootstrap-auth";
import { desktopBootstrap } from "../../../../../../../packages/shared/actions/desktop";

/**
 * One-shot token → cookie exchange. The only URL the shell loads directly.
 *
 * The redirect is the point. A token in the address bar ends up in history, in
 * `Referer` headers on the first outbound link, and in any screenshot the user
 * pastes into a bug report. Exchanging it immediately for an `HttpOnly` cookie
 * and redirecting to a clean URL means the secret exists in exactly one request.
 */


export async function GET(req: Request) {
  if (!isDesktopSession()) {
    // Browser mode has no shell and no token; there is nothing to bootstrap.
    return Response.json({ error: "Not running in the desktop app" }, { status: 404 });
  }

  const token = new URL(req.url).searchParams.get("token");
  const next = new URL(req.url).searchParams.get("next");
  return await desktopBootstrap.handler({ token, next }, {
    execute: ({ token: bootstrapToken, next: destination }) => bootstrap(req, bootstrapToken, destination),
  }) as Response;
}

function bootstrap(req: Request, token: string | null, next: string | null) {
  if (!tokenMatches(token)) {
    // Deliberately terse and deliberately slow to be useful: no hint about
    // length, no hint about how close the guess was.
    return Response.json({ error: "Invalid bootstrap token" }, { status: 403 });
  }

  const target = new URL(next ?? "/", new URL(req.url).origin);
  // Only same-origin redirects. Without this, `?next=https://evil.example`
  // turns the bootstrap route into an open redirect that arrives with the
  // user's freshly minted cookie.
  const destination =
    target.origin === new URL(req.url).origin ? `${target.pathname}${target.search}` : "/";

  // A relative target preserves the loopback host used by the shell.
  const cookie = desktopCookieOptions();
  const response = new Response(null, {
    status: 303,
    headers: {
      Location: destination,
      "Cache-Control": "no-store",
      "Set-Cookie": `${cookie.name}=${encodeURIComponent(token!)}; Path=${cookie.path}; Max-Age=${cookie.maxAge}; HttpOnly; SameSite=Strict`,
    },
  });
  return response;
}
