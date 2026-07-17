import { NextResponse, type NextRequest } from "next/server";
import { runGitRepoAsync } from "@/lib/git-repo-local";
import { parseBlamePorcelain, parseFileHistory } from "@/lib/repo-git-parsers";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

export async function GET(req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const filePath = req.nextUrl.searchParams.get("path");
  if (!filePath || filePath.includes("..") || filePath.startsWith("/")) {
    return NextResponse.json({ error: "Valid path required" }, { status: 400 });
  }

  const [blame, history] = await Promise.all([
    runGitRepoAsync(repoRoot, ["blame", "--line-porcelain", "--", filePath], { timeout: 30_000 }),
    runGitRepoAsync(repoRoot, [
      "log",
      "--max-count=30",
      "--format=%x1e%H%x00%h%x00%s%x00%an%x00%ar",
      "--",
      filePath,
    ]),
  ]);

  if (blame.status !== 0) return gitFail(blame, "Blame failed");
  if (history.status !== 0) return gitFail(history, "File history failed");

  return NextResponse.json({
    path: filePath,
    lines: parseBlamePorcelain(blame.stdout || ""),
    history: parseFileHistory(history.stdout || ""),
  });
}
