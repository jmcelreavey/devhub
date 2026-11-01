import { repoGitFiles } from "../../../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../../../lib/actions/http";
import { runGitRepoAsync } from "../../../../../../lib/git/repo-local";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

/** Tracked file paths for fuzzy pickers (Blame, etc.). */
export async function GET(req: Request, { params }: RepoParams) {
  const { name } = await params;
  return httpAction(repoGitFiles, {
    input: () => ({ name }),
    context: () => ({ read: async (repo) => {
      const response = await readFiles(repo);
      return { status: response.status, body: await response.json() };
    } }),
    response: (result) => Response.json(result.body, { status: result.status }),
  })(req);
}

async function readFiles(name: string) {
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const listed = await runGitRepoAsync(repoRoot, ["ls-files", "-z"], { timeout: 30_000 });
  if (listed.status !== 0) return gitFail(listed, "Could not list files");

  const files = (listed.stdout || "")
    .split("\0")
    .map((p) => p.trim())
    .filter(Boolean);

  return Response.json({ files });
}
