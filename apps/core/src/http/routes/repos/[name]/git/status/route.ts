import { repoGitStatus, type RepoGitStatusResult } from "../../../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../../../lib/actions/http";
import { runGitRepoAsync } from "../../../../../../lib/git/repo-local";
import {
  buildContentBuckets,
  isDevhubRepoRoot,
  matchContentBucket,
} from "../../../../../../lib/content/sync-dirs";
import { fileStatusGlyph, isUnmergedFile, parsePorcelainStatus } from "../../../../../../../../../packages/shared/ui-lib/repos/git-parsers";
import { withScannedRepo, type RepoParams } from "../_shared";

export async function GET(req: Request, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  return httpAction(repoGitStatus, {
    input: () => ({ name }),
    context: () => ({ getStatus: () => readRepoStatus(resolved.repoRoot) }),
    response: (result) => result.ok
      ? Response.json(result.data)
      : Response.json({ error: result.error }, { status: 500 }),
  })(req);
}

async function readRepoStatus(repoRoot: string): Promise<RepoGitStatusResult> {
  const [status, branch, upstream] = await Promise.all([
    runGitRepoAsync(repoRoot, ["status", "--porcelain=v1", "-z"]),
    runGitRepoAsync(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
    runGitRepoAsync(repoRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]),
  ]);

  if (status.status !== 0) return { ok: false, error: status.stderr.trim() || status.stdout.trim() || "Status failed" };

  const allFiles = parsePorcelainStatus(status.stdout || "").map((f) => ({
    ...f,
    status: fileStatusGlyph(f),
  }));

  // In the DevHub repo itself, personal content (notes / tasks / docs /
  // diagrams…) syncs via the top-bar content-sync button — it is not a
  // workspace "change". Other repos keep every file.
  const contentBuckets = isDevhubRepoRoot(repoRoot) ? buildContentBuckets(repoRoot) : [];
  const files =
    contentBuckets.length > 0
      ? allFiles.filter((f) => !matchContentBucket(contentBuckets, f.path))
      : allFiles;
  const contentSyncCount = allFiles.length - files.length;
  const conflictCount = allFiles.filter(isUnmergedFile).length;

  return { ok: true, data: {
    currentBranch: (branch.stdout || "").trim() || "HEAD",
    upstream: upstream.status === 0 ? upstream.stdout.trim() : null,
    files,
    staged: files.filter((f) => f.staged),
    unstaged: files.filter((f) => f.unstaged),
    untracked: files.filter((f) => f.untracked),
    conflictCount,
    contentSyncCount,
    clean: files.length === 0,
  } };
}
