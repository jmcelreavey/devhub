import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isAuthenticatedDesktopRequest } from "@/lib/desktop/bootstrap-auth";
import { formatZodError } from "./schemas";

type RouteHandler<Args extends unknown[]> = (...args: Args) => Promise<Response>;

export function withErrorHandler<Args extends unknown[]>(
  handler: RouteHandler<Args>,
  label?: string,
): RouteHandler<Args> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[api${label ? ":" + label : ""}]`, err);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

/**
 * "This integration has no credentials on this machine."
 *
 * These routes used to answer 400, which says the *caller* sent something
 * malformed. Nothing is wrong with the request — the server simply cannot serve
 * it, which is what 503 means. The distinction is not academic: a client cannot
 * tell a missing API token from a bad ticket key if both are 400, and neither
 * can a log. It also stopped CI being green: a fresh checkout has no
 * `.env.local`, so the Today page's Jira lookups 400'd on every run, and the
 * smoke test that asserts "no console errors" only tolerates the status codes
 * that mean "not your fault".
 *
 * `Retry-After` is deliberately omitted: retrying will not help until somebody
 * configures the integration.
 */
export function notConfigured(what: string): NextResponse {
  return NextResponse.json(
    { error: `${what} is not configured.`, code: "not_configured" },
    { status: 503 },
  );
}

/**
 * Read and validate a JSON request body.
 *
 * The previous signature was `parseBody<T>(req): Promise<T>` implemented as
 * `await req.json() as T` — a type assertion over whatever the client sent. The
 * compiler then cheerfully reported `body.fullName` as `string | undefined`
 * when it was in fact an object, an array or null, and the first `.trim()`
 * turned a should-be-400 into a 500. Worse for the handlers that pass the value
 * on to a path join or a spawn argument.
 *
 * Taking the schema means the type flows *out* of the parse instead of being
 * asserted onto it, and malformed input becomes a 400 describing what was
 * wrong rather than an exception somewhere further down.
 *
 * Usage:
 *
 *   const parsed = await parseBody(req, z.object({ fullName: z.string().min(1) }));
 *   if (!parsed.ok) return parsed.response;
 *   parsed.data.fullName; // string
 */
export async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // `formatZodError` keeps the 400 shape identical to the routes that were
    // already validating by hand (`{ error: "field: message; ..." }`), so
    // migrating a route doesn't change its contract with the client.
    return {
      ok: false,
      response: NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 }),
    };
  }

  return { ok: true, data: parsed.data };
}

/**
 * Loose same-origin check. Mirrors the pattern used across DevHub routes.
 * Same-origin browser requests omit the Origin header, so missing-origin is allowed.
 */
export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("host") ?? "localhost:1337";
  return origin === `http://${host}` || origin === `https://${host}`;
}

/**
 * Strict same-origin check. Requires a present Origin header that matches the
 * request host. Use this for routes that should reject non-browser and
 * cross-origin requests.
 */
export function isSameOriginStrict(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("host") ?? "localhost:1337";
  return origin === `http://${host}` || origin === `https://${host}`;
}

/** Verbs that cannot change state, so a forgeable proof-of-origin is tolerable. */
const SAFE_METHODS = new Set(["GET", "HEAD"]);

/**
 * Weak same-origin proof, accepted on **safe methods only**.
 *
 * Browsers omit Origin on same-origin GET `fetch` (Chrome 150+, Safari,
 * WKWebView) but still send Referer, which is the whole reason this exists.
 *
 * Referer is exactly as forgeable as Origin — any local process can send
 * `curl -e http://localhost:1337/`. So it is not proof of identity, only
 * evidence that a request is not a naive cross-origin one. Honouring it on a
 * mutating verb would reopen the LAN hole `isSameOriginStrict` exists to
 * close, so anything but GET/HEAD is rejected here.
 */
export function isSameOriginReferer(req: NextRequest): boolean {
  if (!SAFE_METHODS.has(req.method.toUpperCase())) return false;
  const referer = req.headers.get("referer");
  const host = req.headers.get("host") ?? "";
  if (!referer || !host) return false;
  try {
    const url = new URL(referer);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const refererHost = url.port ? `${url.hostname}:${url.port}` : url.hostname;
    return refererHost === host;
  } catch {
    return false;
  }
}

/**
 * Authentication guard for sensitive / mutating dashboard routes.
 *
 * Accepts:
 * 1. `X-DevHub-Secret` matching `DEVHUB_API_SECRET` (MCP / local tooling),
 * 2. The packaged-app bootstrap cookie / `x-devhub-token`,
 * 3. Origin matching Host, or
 * 4. **on GET/HEAD only**, Referer matching Host — same-origin GET `fetch`
 *    omits Origin, and a forged header cannot change state on a read.
 *
 * Mutating verbs still require the secret, the desktop session, or a real
 * Origin. Any local process can forge Referer, so accepting it on POST would
 * reopen the LAN hole rule 3 exists to close. Prefer setting
 * `DEVHUB_API_SECRET` when the dashboard is reachable off localhost.
 * See README + `.env.example`.
 */
export function requireDashboardAuth(req: NextRequest): { ok: true } | { ok: false; response: NextResponse } {
  const secret = process.env.DEVHUB_API_SECRET?.trim();
  if (secret) {
    const provided = req.headers.get("x-devhub-secret")?.trim();
    if (provided === secret) return { ok: true };
  }
  if (isAuthenticatedDesktopRequest(req)) return { ok: true };
  if (isSameOriginStrict(req)) return { ok: true };
  if (isSameOriginReferer(req)) return { ok: true };
  const status = secret ? 401 : 403;
  const error = secret ? "Unauthorized" : "Forbidden";
  return { ok: false, response: NextResponse.json({ error }, { status }) };
}
