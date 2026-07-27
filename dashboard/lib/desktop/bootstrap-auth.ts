/**
 * Authentication for the desktop bridge routes.
 *
 * The threat this exists for is specific and not hypothetical. The dashboard
 * listens on `http://127.0.0.1:1337` with no authentication, because it is
 * "only local". But *any* process on the machine can reach that port, and any
 * web page the user visits can make requests to it. Loopback is a transport,
 * not an identity — a page at evil.example can fire a request at
 * `127.0.0.1:1339` and, before this, get a shell.
 *
 * The shell therefore mints a random token per launch, passes it only through
 * the sidecar's environment, and loads exactly one URL carrying it. That route
 * checks it in constant time, sets an `HttpOnly` `SameSite=Strict` cookie, and
 * redirects to a clean URL. Everything sensitive then requires the cookie,
 * which a page on another origin cannot send and script cannot read.
 */
import crypto from "node:crypto";
import type { NextRequest } from "next/server";

export const DESKTOP_COOKIE = "devhub_desktop";
/** The shell's own health probe uses a header; it has no cookie jar. */
export const DESKTOP_TOKEN_HEADER = "x-devhub-token";

/** The per-launch token, or `null` outside the desktop app. */
export function desktopToken(): string | null {
  const token = process.env.DEVHUB_BOOTSTRAP_TOKEN?.trim();
  return token ? token : null;
}

export function isDesktopSession(): boolean {
  return desktopToken() !== null;
}

/**
 * Constant-time comparison.
 *
 * `===` on secrets leaks their prefix through timing. That is a marginal attack
 * over a network and a much less marginal one against a local endpoint an
 * attacker can hammer millions of times with no latency. The length check
 * before `timingSafeEqual` is required by the API and leaks only the length,
 * which is a build-time constant here.
 */
export function tokenMatches(candidate: string | null | undefined): boolean {
  const expected = desktopToken();
  if (!expected || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Is this request from the shell's own webview?
 *
 * Two accepted proofs, both requiring the token: the cookie set at bootstrap
 * (normal page requests) and the header (the Rust health probe, which has no
 * cookie jar). Nothing else counts — notably not the `Origin` header on its
 * own, which any local client can set to anything.
 */
export function isAuthenticatedDesktopRequest(req: NextRequest): boolean {
  if (!isDesktopSession()) return false;
  if (tokenMatches(req.headers.get(DESKTOP_TOKEN_HEADER))) return true;
  return tokenMatches(req.cookies.get(DESKTOP_COOKIE)?.value);
}

/** Cookie attributes for the bootstrap exchange. */
export function desktopCookieOptions() {
  return {
    name: DESKTOP_COOKIE,
    httpOnly: true, // script cannot read it, so XSS cannot exfiltrate it
    sameSite: "strict" as const, // another origin cannot cause it to be sent
    path: "/",
    // No `secure`: the shell serves plain HTTP on loopback, and `secure` would
    // stop the cookie being stored at all. Loopback is not a network hop.
    secure: false,
    maxAge: 60 * 60 * 24,
  };
}

/**
 * Short-lived ticket for the terminal WebSocket.
 *
 * The cookie cannot be the credential here, and finding that out cost a broken
 * terminal in the shipped app: WKWebView does not attach the bootstrap cookie
 * to a `ws://` handshake on a different port, so every connection was rejected
 * with "missing or invalid desktop session cookie". Cookies are host-scoped in
 * the spec, but WebSocket handshake cookie attachment is not something to rely
 * on across engines.
 *
 * So the browser presents something it can actually hold. The dashboard fetches
 * a ticket over same-origin HTTP (where the cookie *does* work), then passes it
 * on the WebSocket URL.
 *
 * The ticket is an HMAC of a coarse time window keyed by the bootstrap token.
 * That shape is deliberate:
 *
 * - The PTY server is a **separate process** from Next, so anything requiring
 *   shared in-memory state would need a store, a socket, or a file — three more
 *   things to get wrong. Both processes already have the token, so both can
 *   compute the same value with no coordination at all.
 * - It **expires**. A ticket in a URL can end up in a log; one that stops
 *   working within a minute is a much smaller problem than a bearer token that
 *   does not.
 * - It is **not** the token. Leaking a ticket does not leak the credential that
 *   guards every other bridge route.
 */
const TICKET_WINDOW_MS = 30_000;

function ticketFor(windowIndex: number, token: string): string {
  return crypto
    .createHmac("sha256", token)
    .update(`devhub-terminal:${windowIndex}`)
    .digest("hex");
}

/** Mint a ticket for the current window. Requires an authenticated caller. */
export function issueTerminalTicket(): string | null {
  const token = desktopToken();
  if (!token) return null;
  return ticketFor(Math.floor(Date.now() / TICKET_WINDOW_MS), token);
}

/**
 * Accept the current or previous window, so a connection that starts just as
 * the window rolls over is not rejected for being a fraction of a second late.
 * Worst-case validity is two windows; that is the cost of not failing at
 * random.
 */
export function isValidTerminalTicket(candidate: string | null | undefined): boolean {
  const token = desktopToken();
  if (!token || !candidate) return false;
  const now = Math.floor(Date.now() / TICKET_WINDOW_MS);
  for (const index of [now, now - 1]) {
    const expected = ticketFor(index, token);
    const a = Buffer.from(candidate);
    const b = Buffer.from(expected);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

/**
 * Exact-origin check for the terminal WebSocket.
 *
 * Still required alongside the ticket. The ticket proves the caller talked to
 * the dashboard; the origin proves the request came from the dashboard's own
 * page rather than from another local page that managed to obtain one.
 */
export function isAllowedTerminalOrigin(origin: string | null | undefined, port: number): boolean {
  if (!origin) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") return false;
  const originPort = parsed.port ? Number.parseInt(parsed.port, 10) : 80;
  return originPort === port;
}
