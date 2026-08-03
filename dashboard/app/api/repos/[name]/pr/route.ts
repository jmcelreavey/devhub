import { NextResponse, type NextRequest } from "next/server";
import { findOpenPrForHeadBranch } from "@/lib/github/branch-pr";
import { isGithubCliAuthenticated } from "@/lib/gh-exec";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { withScannedRepo, type RepoParams } from "../git/_shared";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;

  const configured = await isGithubCliAuthenticated();
  if (!configured) {
    return NextResponse.json({ configured: false, branch: null, pr: null });
  }

  const head = await runGitRepoAsync(resolved.repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = head.status === 0 ? head.stdout.trim() : "";
  if (!branch || branch === "HEAD") {
    return NextResponse.json({ configured: true, branch: branch || null, pr: null });
  }

  const pr = await findOpenPrForHeadBranch(resolved.repoRoot, branch);
  return NextResponse.json({ configured: true, branch, pr });
}
