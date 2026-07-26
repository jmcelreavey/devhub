import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
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

/**
 * Authentication guard for sensitive / mutating dashboard routes.
 *
 * Accepts either:
 * 1. `X-DevHub-Secret` matching `DEVHUB_API_SECRET` (MCP / local tooling), or
 * 2. A **strict** same-origin browser request (Origin present and matches Host).
 *
 * Missing Origin without a valid secret is rejected — that closes the LAN hole
 * where any local process could POST with no Origin. Prefer setting
 * `DEVHUB_API_SECRET` when the dashboard is reachable off localhost.
 * See README + `.env.example`.
 */
export function requireDashboardAuth(req: NextRequest): { ok: true } | { ok: false; response: NextResponse } {
  const secret = process.env.DEVHUB_API_SECRET?.trim();
  if (secret) {
    const provided = req.headers.get("x-devhub-secret")?.trim();
    if (provided === secret) return { ok: true };
  }
  if (isSameOriginStrict(req)) return { ok: true };
  const status = secret ? 401 : 403;
  const error = secret ? "Unauthorized" : "Forbidden";
  return { ok: false, response: NextResponse.json({ error }, { status }) };
}
