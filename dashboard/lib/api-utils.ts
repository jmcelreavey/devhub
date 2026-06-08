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
