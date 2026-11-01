import { ownerVisit, ownerVisitInput, repoOwnerBrief, repoOwnerBriefCore } from "../../../../../../../../../packages/shared/actions/ownership";
import { httpAction } from "../../../../../../lib/actions/http";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../../../lib/api-utils";
import { invalidateResolvedRepos, recordOwnedRepoVisit, resolveOwnedRepo } from "../../../../../../lib/ownership/owned-repos";
import { invalidateOwnershipSummary, loadOwnerBrief, OwnedRepoNotFoundError } from "../../../../../../lib/ownership/service";

interface Params { params: Promise<{ owner: string; name: string }> }
const VisitSchema = ownerVisitInput.omit({ repo: true });

function fullName(owner: string, name: string): string {
  return `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
}

function notOwned(repo: string): Response {
  return Response.json({ error: `${repo} is not an owned repository`, code: "not-owned" }, { status: 404 });
}


export const GET = withErrorHandler(async (req: Request, { params }: Params) => {
  const { owner, name } = await params;
  const action = new URL(req.url).searchParams.get("panels") === "core" ? repoOwnerBriefCore : repoOwnerBrief;
  return httpAction(action, {
    input: () => ({ repo: fullName(owner, name) }),
    context: () => ({ read: async () => {
      const response = await readBrief(req, params);
      return { status: response.status, body: await response.json() };
    } }),
    response: (response) => Response.json(response.body, { status: response.status }),
  })(req);
}, "own.brief.get");

async function readBrief(req: Request, params: Params["params"]) {
  const { owner, name } = await params;
  const repo = fullName(owner, name);
  // `core` drops the two slow panels so the page can paint the PR radar and
  // obligations without waiting on a 90-day git log. MCP callers omit it and
  // still get the whole brief in one request.
  const core = new URL(req.url).searchParams.get("panels") === "core";
  if (core) {
    invalidateResolvedRepos();
    invalidateOwnershipSummary();
  }
  try {
    return Response.json(await loadOwnerBrief(repo, {
      includeGaps: !core,
      includeDigest: !core,
    }));
  } catch (error) {
    if (error instanceof OwnedRepoNotFoundError) return notOwned(repo);
    throw error;
  }
}

export const POST = withErrorHandler(async (req: Request, { params }: Params) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, VisitSchema);
  if (!parsed.ok) return parsed.response;
  const { owner, name } = await params;
  const repo = fullName(owner, name);
  return httpAction(ownerVisit, {
    input: () => ({ repo, ...parsed.data }),
    context: () => ({ write: async ({ repo: owned, headSha }) => {
      if (!await resolveOwnedRepo(owned)) {
        const response = notOwned(owned);
        return { status: response.status, body: await response.json() };
      }
      await recordOwnedRepoVisit(owned, headSha);
      return { status: 200, body: { ok: true } };
    } }),
    response: (result) => Response.json(result.body, { status: result.status }),
  })(req);
}, "own.brief.post");
