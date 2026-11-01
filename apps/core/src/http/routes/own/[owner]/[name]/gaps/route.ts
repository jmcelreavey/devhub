import { ownerLearnOpened, ownerLearnOpenedInput, repoKnowledgeGaps } from "../../../../../../../../../packages/shared/actions/ownership";
import { httpAction } from "../../../../../../lib/actions/http";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../../../lib/api-utils";
import { recordLearnedDomain, resolveOwnedRepo } from "../../../../../../lib/ownership/owned-repos";
import { deriveDomains } from "../../../../../../lib/ownership/domains";
import { loadKnowledgeGaps } from "../../../../../../lib/ownership/service";

interface Params { params: Promise<{ owner: string; name: string }> }
const BodySchema = ownerLearnOpenedInput.omit({ repo: true });

function fullName(owner: string, name: string): string {
  return `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
}

export const GET = withErrorHandler(async (req: Request, { params }: Params) => {
  const { owner, name } = await params;
  return httpAction(repoKnowledgeGaps, {
    input: () => ({ repo: fullName(owner, name) }),
    context: () => ({ read: async () => {
      const response = await readGaps(params);
      return { status: response.status, body: await response.json() };
    } }),
    response: (response) => Response.json(response.body, { status: response.status }),
  })(req);
}, "own.gaps.get");

async function readGaps(params: Params["params"]) {
  const { owner, name } = await params;
  const repo = await resolveOwnedRepo(fullName(owner, name));
  if (!repo) return Response.json({ error: "Owned repo not found" }, { status: 404 });
  const domains = repo.localPath ? await deriveDomains(repo.localPath, repo.domains) : [];
  return Response.json({ gaps: await loadKnowledgeGaps(repo, domains) });
}

export const POST = withErrorHandler(async (req: Request, { params }: Params) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const { owner, name } = await params;
  const repo = fullName(owner, name);
  return httpAction(ownerLearnOpened, {
    input: () => ({ repo, ...parsed.data }),
    context: () => ({ write: async ({ repo: owned, domainId }) => {
      if (!await resolveOwnedRepo(owned)) return { status: 404, body: { error: "Owned repo not found", code: "not-owned" } };
      await recordLearnedDomain(owned, domainId);
      return { status: 200, body: { ok: true } };
    } }),
    response: (result) => Response.json(result.body, { status: result.status }),
  })(req);
}, "own.gaps.post");
