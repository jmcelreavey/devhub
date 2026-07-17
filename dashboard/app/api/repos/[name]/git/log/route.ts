import { NextResponse, type NextRequest } from "next/server";
import { runGitRepoAsync } from "@/lib/git-repo-local";
import { layoutCommitGraph } from "@/lib/repo-git-graph";
import { parseGraphLog } from "@/lib/repo-git-parsers";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

export async function GET(req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;

  const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "40");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 5), 100) : 40;

  const log = await runGitRepoAsync(resolved.repoRoot, [
    "log",
    `--max-count=${limit}`,
    "--decorate=short",
    "--format=%x1e%H%x00%P%x00%h%x00%s%x00%an%x00%ar%x00%D",
  ]);
  if (log.status !== 0) return gitFail(log, "Log failed");

  const commits = parseGraphLog(log.stdout || "");
  const graph = layoutCommitGraph(commits);

  return NextResponse.json({
    commits: graph,
    count: graph.length,
  });
}
