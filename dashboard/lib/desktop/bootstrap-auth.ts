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
 * Exact-origin check for the terminal WebSocket.
 *
 * The PTY hands out an interactive shell. A cookie alone is not enough there:
 * `SameSite` is not applied to WebSocket handshakes by every engine, so the
 * origin is validated too, and it is compared exactly rather than by prefix.
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
