import { NextResponse, type NextRequest } from "next/server";
import { findOpenPrForHeadBranch } from "@/lib/github/branch-pr";
import { isGithubCliAuthenticated } from "@/lib/gh-exec";
import { resolveDefaultRemoteBranch, runGitRepoAsync } from "@/lib/git/repo-local";
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

  // A repo sitting on its own default branch has no feature PR to show. Decided
  // here, from origin/HEAD, rather than by the client guessing "main"/"master" —
  // a trunk called `develop` was still paying for a `gh pr list` on every card.
  const defaultRef = await resolveDefaultRemoteBranch(resolved.repoRoot);
  if (defaultRef && branch === defaultRef.replace(/^origin\//, "")) {
    return NextResponse.json({ configured: true, branch, pr: null, onDefaultBranch: true });
  }

  const pr = await findOpenPrForHeadBranch(resolved.repoRoot, branch);
  return NextResponse.json({ configured: true, branch, pr, onDefaultBranch: false });
}
