import { NextResponse, type NextRequest } from "next/server";
import { requireDashboardAuth } from "@/lib/api-utils";

/**
 * Global auth guard for the dashboard API.
 *
 * Every mutating /api request must pass `requireDashboardAuth` (strict
 * same-origin browser request, or `X-DevHub-Secret` matching
 * `DEVHUB_API_SECRET`). Individual routes may still call the guard themselves;
 * this proxy is the safety net so a new route can't ship unguarded by
 * accident.
 *
 * Callers that this intentionally allows:
 * - Browsers (same-origin fetches send a matching Origin header)
 * - The MCP dashboard client (sends Origin + optional X-DevHub-Secret)
 * - Phones via the LAN port proxy (raw TCP pipe, Host header preserved)
 *
 * Callers this intentionally blocks: origin-less POSTs (e.g. bare curl or a
 * random LAN process). Send an `Origin: http://<host>` header or the
 * `X-DevHub-Secret` header if you need scripted access.
 *
 * THIS IS THE ONLY PLACE THE RULE LIVES. Individual routes used to repeat an
 * `isSameOrigin(req)` check of their own; those were removed because they were
 * both redundant and *weaker* — `isSameOrigin` is the loose variant that
 * returns true when Origin is absent, so reading one of those routes implied a
 * guarantee this proxy does not need to rely on. Don't reintroduce them.
 *
 * Note the scope: mutating methods only. A GET that needs an origin check must
 * still do it itself (see app/api/briefing/image/route.ts, the one remaining
 * in-route caller).
 */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function proxy(req: NextRequest) {
  if (MUTATING_METHODS.has(req.method)) {
    const auth = requireDashboardAuth(req);
    if (!auth.ok) return auth.response;
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
