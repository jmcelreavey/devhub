import { z } from "zod";
import { ownerDigest, ownerDigestGenerate, ownerDigestGenerateInput } from "../../../../../../../../../packages/shared/actions/ownership";
import { httpAction } from "../../../../../../lib/actions/http";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../../../lib/api-utils";
import { deriveDomains } from "../../../../../../lib/ownership/domains";
import { resolveOwnedRepo } from "../../../../../../lib/ownership/owned-repos";
import { loadRepoDigest } from "../../../../../../lib/ownership/service";
import { catchUpSince } from "../../../../../../lib/catch-up";

interface Params { params: Promise<{ owner: string; name: string }> }
const BodySchema = ownerDigestGenerateInput.omit({ repo: true });

async function repoAndDomains(params: Params["params"]) {
  const { owner, name } = await params;
  const repo = await resolveOwnedRepo(`${decodeURIComponent(owner)}/${decodeURIComponent(name)}`);
  if (!repo) return null;
  return { repo, domains: repo.localPath ? await deriveDomains(repo.localPath, repo.domains) : [] };
}

export const GET = withErrorHandler(async (req: Request, { params }: Params) => {
  const { owner, name } = await params;
  return httpAction(ownerDigest, {
    input: () => ({ repo: `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`, since: new URL(req.url).searchParams.get("since") ?? undefined }),
    context: () => ({ read: async () => {
      const response = await readDigest(req, params);
      return { status: response.status, body: await response.json() };
    } }),
    response: (response) => Response.json(response.body, { status: response.status }),
  })(req);
}, "own.digest.get");

async function readDigest(req: Request, params: Params["params"]) {
  const resolved = await repoAndDomains(params);
  if (!resolved) return Response.json({ error: "Owned repo not found", code: "not-owned" }, { status: 404 });
  const since = new URL(req.url).searchParams.get("since");
  // `since=recent` ignores the watermark and shows the tail of history. Without
  // it, an owner who has caught up has no way back to what they just read.
  const explicit = since && /^[0-9a-f]{7,64}$/i.test(since) ? since : resolved.repo.lastSeenSha;
  const sinceSha = catchUpSince(since === "recent" ? "recent" : "watermark", explicit);
  return Response.json(await loadRepoDigest(resolved.repo, resolved.domains, { sinceSha }));
}

export const POST = withErrorHandler(async (req: Request, { params }: Params) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const { owner, name } = await params;
  const repo = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
  return httpAction(ownerDigestGenerate, {
    input: () => ({ repo, ...parsed.data }),
    context: () => ({ write: async () => {
      const response = await generateDigest(params, parsed.data);
      return { status: response.status, body: await response.json() };
    } }),
    response: (result) => Response.json(result.body, { status: result.status }),
  })(req);
}, "own.digest.post");

async function generateDigest(params: Params["params"], input: z.output<typeof BodySchema>) {
  const resolved = await repoAndDomains(params);
  if (!resolved) return Response.json({ error: "Owned repo not found" }, { status: 404 });
  return Response.json(await loadRepoDigest(resolved.repo, resolved.domains, { ...input, generate: true }));
}
