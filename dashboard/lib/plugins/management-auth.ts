/**
 * Who may manage plugins.
 *
 * Plugin management changes what the person's AI tools run, so the dashboard's
 * general "same origin" rule is not enough: it is built to work from another
 * device on the LAN, and a request that merely names its own Host and Origin
 * proves nothing about the peer. Loopback is a network boundary, not identity.
 */
import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { isSameOriginReferer, isSameOriginStrict } from "@/lib/api-utils";
import { desktopToken, isAuthenticatedDesktopRequest } from "@/lib/desktop/bootstrap-auth";

export const MANAGEMENT_BLOCKED = "Plugin management is available from the DevHub desktop app or a local-only dashboard session.";

const SAFE_METHODS = new Set(["GET", "HEAD"]);

export type ManagementDecision = { ok: true } | { ok: false; status: 401 | 403 };

function secretMatches(candidate: string | null, expected: string | undefined): boolean {
  if (!expected || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The dashboard was started listening on loopback only, with nothing forwarding the LAN to it. */
export function loopbackOnly(env: NodeJS.ProcessEnv): boolean {
  if (env.DEVHUB_LAN_PROXY_HOST?.trim()) return false;
  const bind = (env.DEVHUB_BIND_HOST ?? "").trim().toLowerCase();
  return bind === "127.0.0.1" || bind === "::1" || bind === "localhost";
}

/**
 * The Host header names where the request says it is going. A loopback listener
 * reached through a rebound DNS name still sees that name here, so only the
 * loopback names count.
 */
export function hostIsLoopback(req: NextRequest): boolean {
  const host = (req.headers.get("host") ?? "").trim().toLowerCase();
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]";
}

/**
 * Order of proof:
 * 1. `X-DevHub-Secret` — scripted local access (constant-time compare).
 * 2. The desktop session cookie. It rides on any request from a page on the
 *    same host, whatever its port, so a change also needs a same-origin Origin.
 * 3. A browser-only session, but only when the listener is loopback-only, the
 *    request names a loopback host, and it is same-origin.
 */
export function decideManagement(req: NextRequest, env: NodeJS.ProcessEnv = process.env): ManagementDecision {
  if (secretMatches(req.headers.get("x-devhub-secret"), env.DEVHUB_API_SECRET?.trim())) return { ok: true };
  const mutating = !SAFE_METHODS.has(req.method.toUpperCase());
  const sameOrigin = isSameOriginStrict(req) || (!mutating && isSameOriginReferer(req));
  if (isAuthenticatedDesktopRequest(req)) {
    return hostIsLoopback(req) && sameOrigin ? { ok: true } : { ok: false, status: 403 };
  }
  if (desktopToken() === null && loopbackOnly(env) && hostIsLoopback(req) && sameOrigin) return { ok: true };
  return { ok: false, status: 403 };
}
