import { NextResponse, type NextRequest } from "next/server";
import { findOpenPrForHeadBranch } from "@/lib/github/branch-pr";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { withScannedRepo, type RepoParams } from "../_shared";

/**
 * The open PR whose head branch is the repo's current branch, with its CI
 * rollup. Fetched lazily by the History tab (never in the hot path) so a slow
 * or missing `gh` costs nothing; every failure degrades to null.
 */
export async function GET(_req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;

  const head = await runGitRepoAsync(resolved.repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = head.status === 0 ? head.stdout.trim() : "";
  if (!branch || branch === "HEAD") {
    return NextResponse.json({ pr: null });
  }
  const pr = await findOpenPrForHeadBranch(resolved.repoRoot, branch);
  return NextResponse.json({ pr });
}
