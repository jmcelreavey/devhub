import { NextResponse, type NextRequest } from "next/server";

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

export async function parseBody<T>(req: Request): Promise<T> {
  try { return await req.json() as T; } catch { return {} as T; }
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
 * Authentication guard for sensitive dashboard routes.
 *
 * - If `DEVHUB_API_SECRET` is configured, requests must provide it in the
 *   `X-DevHub-Secret` header.
 * - Otherwise, a strict same-origin check is enforced (browser requests only).
 */
export function requireDashboardAuth(req: NextRequest): { ok: true } | { ok: false; response: NextResponse } {
  const secret = process.env.DEVHUB_API_SECRET?.trim();
  if (secret) {
    const provided = req.headers.get("x-devhub-secret")?.trim();
    if (provided !== secret) {
      return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    }
    return { ok: true };
  }
  if (!isSameOriginStrict(req)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true };
}
