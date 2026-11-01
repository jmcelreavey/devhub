import { isAuthenticatedDesktopRequest } from "../local/terminal/bootstrap-auth";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SAFE_METHODS = new Set(["GET", "HEAD"]);

export function isSameOriginStrict(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("host") ?? "localhost:1337";
  return origin === `http://${host}` || origin === `https://${host}`;
}

export function isSameOriginReferer(req: Request): boolean {
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

export function requireDashboardAuth(req: Request): { ok: true } | { ok: false; response: Response } {
  const secret = process.env.DEVHUB_API_SECRET?.trim();
  if (secret && req.headers.get("x-devhub-secret")?.trim() === secret) return { ok: true };
  if (isAuthenticatedDesktopRequest(req) || isSameOriginStrict(req) || isSameOriginReferer(req)) return { ok: true };
  return { ok: false, response: Response.json({ error: secret ? "Unauthorized" : "Forbidden" }, { status: secret ? 401 : 403 }) };
}

/** The global API guard shared by Next's proxy and the standalone server. */
export function dashboardApiGuard(req: Request): { response?: Response; bypassAliases?: true } {
  const pathname = new URL(req.url).pathname;
  // This endpoint authenticates its short-lived bearer token in the handler.
  if (req.method === "POST" && pathname === "/api/editor/incoming"
    && !req.headers.has("origin") && /^Bearer [A-Za-z0-9_-]{43}$/.test(req.headers.get("authorization") ?? "")) {
    return { bypassAliases: true };
  }
  if (pathname.startsWith("/api/") && MUTATING_METHODS.has(req.method)) {
    const auth = requireDashboardAuth(req);
    if (!auth.ok) return { response: auth.response };
  }
  return {};
}
