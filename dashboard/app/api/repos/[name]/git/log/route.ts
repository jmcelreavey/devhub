import { NextResponse, type NextRequest } from "next/server";
import { resolveDefaultRemoteBranch, runGitRepoAsync } from "@/lib/git/repo-local";
import { layoutCommitGraph } from "@/lib/repos/git-graph";
import { parseGraphLog } from "@/lib/repos/git-parsers";
import { parseLeftRightCount } from "../../branches/parsers";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

function shortMainName(ref: string | null): string | null {
  if (!ref) return null;
  return ref.replace(/^origin\//, "");
}

export async function GET(req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;

  const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "40");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 5), 100) : 40;

  const [mainBranch, headResult] = await Promise.all([
    resolveDefaultRemoteBranch(resolved.repoRoot),
    runGitRepoAsync(resolved.repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
  ]);
  const currentBranch = headResult.status === 0 ? headResult.stdout.trim() : "HEAD";

  // Include the default remote tip so the graph shows fork/merge vs main,
  // not just a flat walk of the current branch.
  const tips = ["HEAD"];
  if (mainBranch) tips.push(mainBranch);

  const [log, mainAheadBehind] = await Promise.all([
    runGitRepoAsync(resolved.repoRoot, [
      "log",
      ...tips,
      `--max-count=${limit}`,
      "--decorate=short",
      "--format=%x1e%H%x00%P%x00%h%x00%s%x00%an%x00%ar%x00%D",
    ]),
    mainBranch
      ? runGitRepoAsync(resolved.repoRoot, [
          "rev-list",
          "--left-right",
          "--count",
          `${mainBranch}...HEAD`,
        ])
      : Promise.resolve({ status: 1, stdout: "", stderr: "" }),
  ]);
  if (log.status !== 0) return gitFail(log, "Log failed");

  const commits = parseGraphLog(log.stdout || "");
  const graph = layoutCommitGraph(commits);
  const counts =
    mainAheadBehind.status === 0
      ? parseLeftRightCount(mainAheadBehind.stdout)
      : { left: 0, right: 0 };
  const mainShort = shortMainName(mainBranch);
  const onMain =
    Boolean(mainShort) &&
    (currentBranch === mainShort || currentBranch === mainBranch);
  const aheadMain = counts.right;
  const behindMain = counts.left;
  // Tip is reachable from main → fully merged (or identical).
  const mergedIntoMain = Boolean(mainBranch) && !onMain && aheadMain === 0;

  return NextResponse.json({
    commits: graph,
    count: graph.length,
    currentBranch,
    mainBranch,
    mainShort,
    aheadMain,
    behindMain,
    onMain,
    mergedIntoMain,
  });
}
