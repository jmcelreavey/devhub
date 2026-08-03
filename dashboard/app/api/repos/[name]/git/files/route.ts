import { NextResponse, type NextRequest } from "next/server";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

/** Tracked file paths for fuzzy pickers (Blame, etc.). */
export async function GET(_req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const listed = await runGitRepoAsync(repoRoot, ["ls-files", "-z"], { timeout: 30_000 });
  if (listed.status !== 0) return gitFail(listed, "Could not list files");

  const files = (listed.stdout || "")
    .split("\0")
    .map((p) => p.trim())
    .filter(Boolean);

  return NextResponse.json({ files });
}
