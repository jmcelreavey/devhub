import { repoPrCurrent, repoPrLocal, repoPrRemote, repoPrRemoteInput } from "../../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../../lib/actions/http";
import { findOpenPrForGithubBranch, findOpenPrForHeadBranch } from "../../../../../lib/github/branch-pr";
import { parseRepoFullNameFromRemote } from "../../../../../../../../packages/shared/ui-lib/github/repo-url";
import { requireDashboardAuth } from "../../../../../lib/api-utils";
import { isGithubCliAuthenticated } from "../../../../../lib/gh-exec";
import { resolveDefaultRemoteBranch, runGitRepoAsync } from "../../../../../lib/git/repo-local";
import { withScannedRepo, type RepoParams } from "../git/_shared";


export async function GET(req: Request, { params }: RepoParams) {
  const scope = new URL(req.url).searchParams.get("scope");
  if (scope === "remote") {
    const auth = requireDashboardAuth(req);
    if (!auth.ok) return auth.response;
    const fullName = new URL(req.url).searchParams.get("repo") ?? "";
    const branch = new URL(req.url).searchParams.get("branch") ?? "";
    const parsed = repoPrRemoteInput.safeParse({ fullName, branch });
    if (!parsed.success) {
      return Response.json({ error: "Invalid repository or branch" }, { status: 400 });
    }
    return httpAction(repoPrRemote, {
      input: () => parsed.data,
      context: () => ({ read: async (repo, ref) => {
        const configured = await isGithubCliAuthenticated();
        return { status: 200, body: { configured, branch: ref, pr: configured ? await findOpenPrForGithubBranch(repo, ref) : null } };
      } }),
      response: (result) => Response.json(result.body, { status: result.status }),
    })(req);
  }
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;

  const action = scope === "local" ? repoPrLocal : repoPrCurrent;
  return httpAction(action, {
    input: () => ({ name }),
    context: () => ({ read: async () => {
      const response = scope === "local" ? await readLocalPr(resolved.repoRoot) : await readCurrentPr(resolved.repoRoot);
      return { status: response.status, body: await response.json() };
    } }),
    response: (result) => Response.json(result.body, { status: result.status }),
  })(req);
}

async function readLocalPr(repoRoot: string) {
  const [head, defaultRef, remote] = await Promise.all([
    runGitRepoAsync(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
    resolveDefaultRemoteBranch(repoRoot),
    runGitRepoAsync(repoRoot, ["remote", "get-url", "origin"]),
  ]);
  const branch = head.status === 0 ? head.stdout.trim() : "";
  return Response.json({
    branch: branch || null,
    fullName: remote.status === 0 ? parseRepoFullNameFromRemote(remote.stdout.trim()) : null,
    onDefaultBranch: !!defaultRef && branch === defaultRef.replace(/^origin\//, ""),
  });
}

async function readCurrentPr(repoRoot: string) {
  const configured = await isGithubCliAuthenticated();
  if (!configured) {
    return Response.json({ configured: false, branch: null, pr: null });
  }

  const head = await runGitRepoAsync(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = head.status === 0 ? head.stdout.trim() : "";
  if (!branch || branch === "HEAD") {
    return Response.json({ configured: true, branch: branch || null, pr: null });
  }

  // A repo sitting on its own default branch has no feature PR to show. Decided
  // here, from origin/HEAD, rather than by the client guessing "main"/"master" —
  // a trunk called `develop` was still paying for a `gh pr list` on every card.
  const defaultRef = await resolveDefaultRemoteBranch(repoRoot);
  if (defaultRef && branch === defaultRef.replace(/^origin\//, "")) {
    return Response.json({ configured: true, branch, pr: null, onDefaultBranch: true });
  }

  const pr = await findOpenPrForHeadBranch(repoRoot, branch);
  return Response.json({ configured: true, branch, pr, onDefaultBranch: false });
}
