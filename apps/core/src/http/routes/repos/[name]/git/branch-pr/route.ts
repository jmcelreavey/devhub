import { repoGitBranchPr } from "../../../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../../../lib/actions/http";
import { findOpenPrForHeadBranch } from "../../../../../../lib/github/branch-pr";
import { runGitRepoAsync } from "../../../../../../lib/git/repo-local";
import { withScannedRepo, type RepoParams } from "../_shared";

/**
 * The open PR whose head branch is the repo's current branch, with its CI
 * rollup. Fetched lazily by the History tab (never in the hot path) so a slow
 * or missing `gh` costs nothing; every failure degrades to null.
 */
export async function GET(req: Request, routeParams: RepoParams) {
  const { name } = await routeParams.params;
  return httpAction(repoGitBranchPr, {
    input: () => ({ name }),
    context: () => ({ ci: async () => {
      const response = await readBranchPr(req, routeParams);
      return { status: response.status, body: await response.json() };
    } }),
    response: (result) => Response.json(result.response.body, { status: result.response.status }),
  })(req);
}

async function readBranchPr(_req: Request, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;

  const head = await runGitRepoAsync(resolved.repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = head.status === 0 ? head.stdout.trim() : "";
  if (!branch || branch === "HEAD") {
    return Response.json({ pr: null });
  }
  const pr = await findOpenPrForHeadBranch(resolved.repoRoot, branch);
  return Response.json({ pr });
}
