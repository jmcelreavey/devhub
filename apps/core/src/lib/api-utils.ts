import { ContentConflictError } from "../../../../packages/shared/storage/content";
import { z } from "zod";
import { requireDashboardAuth as requireWebDashboardAuth } from "../http/auth";
export { isSameOriginStrict, isSameOriginReferer } from "../http/auth";
import { formatZodError } from "./schemas";
import { requestedTaskProfile, taskProfileConflict, withTaskProfileRequest } from "../domains/tasks/profile-request";
import { expireSidebarCountsCache } from "./activity/sidebar-counts-cache";

type RouteHandler<Args extends unknown[]> = (...args: Args) => Promise<Response>;

export function withErrorHandler<Args extends unknown[]>(
  handler: RouteHandler<Args>,
  label?: string,
): RouteHandler<Args> {
  return async (...args: Args) => {
    try {
      const request = args[0] instanceof Request ? args[0] : undefined;
      const profile = request ? requestedTaskProfile(request) : null;
      if (profile !== null) {
        const conflict = taskProfileConflict(profile);
        if (conflict) return conflict;
      }
      const response = await (profile === null ? handler(...args) : withTaskProfileRequest(profile, () => handler(...args)));
      if (profile !== null && request?.method === "GET") {
        const conflict = taskProfileConflict(profile);
        if (conflict) return conflict;
        response.headers.set("Cache-Control", "no-store");
      } else if (profile !== null && response.ok) {
        expireSidebarCountsCache(profile);
      }
      return response;
    } catch (err) {
      if (err instanceof ContentConflictError) return Response.json({ error: "This content changed elsewhere. Reload and try again." }, { status: 409 });
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[api${label ? ":" + label : ""}]`, err);
      return Response.json({ error: message }, { status: 500 });
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
export function notConfigured(what: string): Response {
  return Response.json(
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
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // `formatZodError` keeps the 400 shape identical to the routes that were
    // already validating by hand (`{ error: "field: message; ..." }`), so
    // migrating a route doesn't change its contract with the client.
    return {
      ok: false,
      response: Response.json({ error: formatZodError(parsed.error) }, { status: 400 }),
    };
  }

  return { ok: true, data: parsed.data };
}

/**
 * Loose same-origin check. Mirrors the pattern used across DevHub routes.
 * Same-origin browser requests omit the Origin header, so missing-origin is allowed.
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("host") ?? "localhost:1337";
  return origin === `http://${host}` || origin === `https://${host}`;
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
export function requireDashboardAuth(req: Request): { ok: true } | { ok: false; response: Response } {
  const result = requireWebDashboardAuth(req);
  if (result.ok) return result;
  return { ok: false, response: new Response(result.response.body, result.response) };
}
