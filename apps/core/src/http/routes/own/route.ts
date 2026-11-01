import { ownedRepoAdd, ownedRepoChangeInput, ownedRepoRemove, ownedRepos, ownedReposIdentity, ownedReposRemote, ownedReposRemoteInput, ownedReposResolved } from "../../../../../../packages/shared/actions/ownership";
import { httpAction } from "../../../lib/actions/http";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../lib/api-utils";
import { addOwnedRepo, invalidateResolvedRepos, listOwnedRepos, removeOwnedRepo, resolveOwnedRepos } from "../../../lib/ownership/owned-repos";
import { invalidateOwnershipSummary, loadOwnershipSummary, refreshOwnershipRemote } from "../../../lib/ownership/service";


export const GET = withErrorHandler(async (req: Request) => {
  const scope = new URL(req.url).searchParams.get("scope");
  if (scope === "remote") {
    const auth = requireDashboardAuth(req);
    if (!auth.ok) return auth.response;
    let payload: unknown;
    try {
      payload = JSON.parse(new URL(req.url).searchParams.get("repos") ?? "null");
    } catch {
      return Response.json({ error: "Invalid repositories" }, { status: 400 });
    }
    const parsed = ownedReposRemoteInput.shape.repos.safeParse(payload);
    if (!parsed.success) return Response.json({ error: "Invalid repositories" }, { status: 400 });
    return httpAction(ownedReposRemote, {
      input: () => ({ repos: parsed.data }),
      context: () => ({ refresh: async (repos) => {
        await refreshOwnershipRemote(repos);
        return { status: 200, body: { ok: true } };
      } }),
      response: (result) => Response.json(result.body, { status: result.status }),
    })(req);
  }
  const list = async () => {
    const response = await listOwned(req);
    return { status: response.status, body: await response.json() };
  };
  const adapter = {
    input: () => ({}),
    context: () => ({ list }),
    response: (result: { status: number; body: unknown }) => Response.json(result.body, { status: result.status }),
  };
  if (scope === "identity") return httpAction(ownedReposIdentity, adapter)(req);
  if (new URL(req.url).searchParams.get("summary") === "1") {
    return httpAction(ownedRepos, adapter)(req);
  }
  return httpAction(ownedReposResolved, adapter)(req);
}, "own.get");

async function listOwned(req: Request) {
  if (new URL(req.url).searchParams.get("scope") === "identity") {
    return Response.json({ repos: listOwnedRepos().map(({ name, fullName }) => ({ name, fullName })) });
  }
  if (new URL(req.url).searchParams.get("summary") === "1") {
    invalidateResolvedRepos();
    invalidateOwnershipSummary();
  }
  const repos = await resolveOwnedRepos();
  if (new URL(req.url).searchParams.get("summary") !== "1") return Response.json({ repos });
  // Obligation-level only. Gaps and catch-up history are per-repo panels and are
  // far too expensive to compute once per owned repo just to render the index.
  return Response.json({ repos, summaries: await loadOwnershipSummary() });
}

export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, ownedRepoChangeInput);
  if (!parsed.ok) return parsed.response;
  return httpAction(ownedRepoAdd, {
    input: () => parsed.data,
    context: () => ({ change: async (fullName) => {
      const repo = await addOwnedRepo(fullName);
      invalidateOwnershipSummary();
      return { status: 201, body: { ok: true, repo } };
    } }),
    response: (result) => Response.json(result.body, { status: result.status }),
  })(req);
}, "own.post");

export const DELETE = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, ownedRepoChangeInput);
  if (!parsed.ok) return parsed.response;
  return httpAction(ownedRepoRemove, {
    input: () => parsed.data,
    context: () => ({ change: async (fullName) => {
      await removeOwnedRepo(fullName);
      invalidateOwnershipSummary();
      return { status: 200, body: { ok: true } };
    } }),
    response: (result) => Response.json(result.body, { status: result.status }),
  })(req);
}, "own.delete");
