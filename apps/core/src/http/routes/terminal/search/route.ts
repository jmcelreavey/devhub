import { httpAction } from "../../../../lib/actions/http";
import { terminalSearch } from "../../../../../../../packages/shared/actions/terminal";
import { searchTerminalSessions } from "../../../../local/terminal/search";

/**
 * Search recent terminal transcripts. Read-only.
 *
 * Every line returned has been through `redactSecrets` — see the module header
 * in apps/core/src/local/terminal/search.ts for why that is a precondition of this route
 * existing at all, not a nicety.
 */

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200)
    : undefined;
  return httpAction(terminalSearch, {
    input: () => ({ q, limit }),
    context: () => ({ search: searchTerminalSessions }),
    response: (body) => Response.json(body),
  })(req);
}
