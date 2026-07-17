import { NextResponse, type NextRequest } from "next/server";
import { runGitRepoAsync } from "@/lib/git-repo-local";
import { detectUnmergedFiles } from "@/lib/git-conflicts";
import {
  buildContentBuckets,
  isDevhubRepoRoot,
  matchContentBucket,
} from "@/lib/content-sync-dirs";
import { fileStatusGlyph, parsePorcelainStatus } from "@/lib/repo-git-parsers";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

export async function GET(_req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const [status, branch, upstream] = await Promise.all([
    runGitRepoAsync(repoRoot, ["status", "--porcelain=v1", "-z"]),
    runGitRepoAsync(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
    runGitRepoAsync(repoRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]),
  ]);

  if (status.status !== 0) return gitFail(status, "Status failed");

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
  const conflicts = detectUnmergedFiles(repoRoot);

  return NextResponse.json({
    currentBranch: (branch.stdout || "").trim() || "HEAD",
    upstream: upstream.status === 0 ? upstream.stdout.trim() : null,
    files,
    staged: files.filter((f) => f.staged),
    unstaged: files.filter((f) => f.unstaged),
    untracked: files.filter((f) => f.untracked),
    conflictCount: conflicts.length,
    contentSyncCount,
    clean: files.length === 0,
  });
}
