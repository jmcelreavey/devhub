import { ownerBlast, ownerBlastInput } from "../../../../../../../../../packages/shared/actions/ownership";
import { httpAction } from "../../../../../../lib/actions/http";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../../../lib/api-utils";
import { resolveOwnedRepo } from "../../../../../../lib/ownership/owned-repos";
import { loadBlastRadius } from "../../../../../../lib/ownership/service";

interface Params { params: Promise<{ owner: string; name: string }> }
// The service truncates to MAX_BLAST_PATHS and reports it, so this bound only
// exists to reject absurd payloads — not to reject large pull requests, which
// used to fail validation and leave the expanded row silently empty.
const BodySchema = ownerBlastInput.omit({ repo: true });

export const POST = withErrorHandler(async (req: Request, { params }: Params) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const { owner, name } = await params;
  const fullName = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
  return httpAction(ownerBlast, {
    input: () => ({ repo: fullName, ...parsed.data }),
    context: () => ({ write: async ({ repo: owned, paths }) => {
      const resolved = await resolveOwnedRepo(owned);
      if (!resolved) return { status: 404, body: { error: `${owned} is not an owned repository`, code: "not-owned" } };
      return { status: 200, body: await loadBlastRadius(resolved, paths) };
    } }),
    response: (result) => Response.json(result.body, { status: result.status }),
  })(req);
}, "own.blast");
