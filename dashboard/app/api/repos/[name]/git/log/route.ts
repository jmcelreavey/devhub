import { NextResponse, type NextRequest } from "next/server";
import { resolveDefaultRemoteBranch, runGitRepoAsync } from "@/lib/git/repo-local";
import { layoutCommitGraph, openBoundary } from "@/lib/repos/git-graph";
import { parseGraphLog } from "@/lib/repos/git-parsers";
import { parseLeftRightCount } from "../../branches/parsers";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

function shortMainName(ref: string | null): string | null {
  if (!ref) return null;
  return ref.replace(/^origin\//, "");
}

/**
 * Continuation tips arrive as hashes from a previous page's open frontier. They
 * are interpolated into a git argv, so accept only what a hash can look like —
 * anything else is dropped rather than corrected, since a malformed cursor is a
 * bug on our side and should not be guessed at.
 */
/**
 * Resolve a query that looks like a commit hash to a full sha.
 *
 * Searching for a hash is the one case `--grep` cannot serve — the hash is not
 * in the message — and it is a common thing to paste in. Only hex of a
 * plausible length is tried, so an ordinary word never costs a subprocess, and
 * `^{commit}` keeps a tag or tree from resolving here.
 */
async function resolveCommitish(repoRoot: string, query: string): Promise<string | null> {
  if (!/^[0-9a-f]{4,40}$/i.test(query)) return null;
  const result = await runGitRepoAsync(repoRoot, ["rev-parse", "--verify", `${query}^{commit}`]);
  if (result.status !== 0) return null;
  const sha = result.stdout.trim();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

function parseTips(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => /^[0-9a-f]{7,40}$/.test(t))
    .slice(0, 64);
}

export async function GET(req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;

  const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "40");
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.floor(limitRaw), 5), 100)
    : 40;
  const cursorTips = parseTips(req.nextUrl.searchParams.get("tips"));
  // `scope=current` walks only HEAD and the default remote tip, which is the old
  // behaviour and stays available for very wide repos.
  const scope = req.nextUrl.searchParams.get("scope") === "current" ? "current" : "all";
  const query = (req.nextUrl.searchParams.get("q") ?? "").trim();
  // Repeatable: one person commits under several addresses, and `git log` ORs
  // repeated `--author` patterns.
  const authorMatches = req.nextUrl.searchParams
    .getAll("author")
    .map((a) => a.trim())
    .filter(Boolean)
    .slice(0, 16);
  const offsetRaw = Number(req.nextUrl.searchParams.get("offset") ?? "0");
  const offset = Number.isFinite(offsetRaw) ? Math.max(Math.floor(offsetRaw), 0) : 0;

  const [mainBranch, headResult] = await Promise.all([
    resolveDefaultRemoteBranch(resolved.repoRoot),
    runGitRepoAsync(resolved.repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
  ]);
  const currentBranch = headResult.status === 0 ? headResult.stdout.trim() : "HEAD";

  // Continuation pages walk from the previous page's open frontier. A first
  // page walks every ref: with only HEAD and the default remote tip the graph
  // is close to linear by construction, so the rail showed a single column and
  // the lane palette never came into play.
  const walkArgs =
    cursorTips.length > 0
      ? cursorTips
      : scope === "current"
        ? mainBranch
          ? ["HEAD", mainBranch]
          : ["HEAD"]
        : ["HEAD", "--branches", "--remotes", "--tags"];

  // A query that looks like a hash is a jump, not a text search: `--grep` would
  // never match it, since the hash is not in the message.
  const directHit = await resolveCommitish(resolved.repoRoot, query);

  const searchArgs = [
    ...(query && !directHit ? ["--regexp-ignore-case", `--grep=${query}`, "--fixed-strings"] : []),
    ...authorMatches.map((a) => `--author=${a}`),
  ];
  const searching = searchArgs.length > 0 || Boolean(directHit);

  const [log, mainAheadBehind, forkInfo] = await Promise.all([
    runGitRepoAsync(resolved.repoRoot, [
      "log",
      // A resolved hash replaces the walk entirely — the user asked for one
      // commit, so widening from it would bury the thing they typed.
      ...(directHit ? [directHit, "--max-count=1"] : walkArgs),
      ...(directHit ? [] : [`--max-count=${limit + 1}`]),
      ...(searching && offset > 0 && !directHit ? [`--skip=${offset}`] : []),
      // Date order keeps the rows in the order a reader expects while still
      // never placing a parent above its child, which is what the lane
      // assignment relies on.
      "--date-order",
      ...searchArgs,
      "--decorate=short",
      "--format=%x1e%H%x00%P%x00%h%x00%s%x00%an%x00%ar%x00%D%x00%ae%x00%G?",
    ]),
    mainBranch
      ? runGitRepoAsync(resolved.repoRoot, [
          "rev-list",
          "--left-right",
          "--count",
          `${mainBranch}...HEAD`,
        ])
      : Promise.resolve({ status: 1, stdout: "", stderr: "" }),
    // Where this branch came off main, and exactly which local commits are
    // not on main yet — the two facts that make "how far ahead am I" readable
    // straight off the graph instead of via a count in a strip.
    mainBranch
      ? Promise.all([
          runGitRepoAsync(resolved.repoRoot, ["merge-base", "HEAD", mainBranch]),
          runGitRepoAsync(resolved.repoRoot, [
            "rev-list",
            `${mainBranch}..HEAD`,
            "--max-count=300",
          ]),
        ])
      : Promise.resolve(null),
  ]);
  if (log.status !== 0) return gitFail(log, "Log failed");

  const parsedCommits = parseGraphLog(log.stdout || "");
  const commits = parsedCommits.slice(0, limit);
  const graph = layoutCommitGraph(commits);

  /*
   * Two paging strategies, because the walks are different shapes.
   *
   * An unfiltered walk pages from the open frontier — the parents it referenced
   * but did not reach. That is the set of lanes still hanging off the bottom of
   * the page, so continuing from it resumes exactly where the graph stopped.
   *
   * A filtered walk cannot: the parent of a matching commit is usually not
   * itself a match, so the frontier is neither the next results nor a bounded
   * set. There the offset is the honest cursor, since the filtered walk is a
   * single ordered sequence and skipping into it is well defined.
   */
  const nextTips = searching ? [] : openBoundary(commits);
  const nextOffset = searching && parsedCommits.length > limit ? offset + commits.length : null;
  const hasMore = searching ? nextOffset !== null : nextTips.length > 0;
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

  const forkBaseHash =
    forkInfo && forkInfo[0].status === 0 ? forkInfo[0].stdout.trim() || null : null;
  const aheadOfMain =
    forkInfo && forkInfo[1].status === 0
      ? forkInfo[1].stdout.split("\n").map((l) => l.trim()).filter(Boolean)
      : [];

  return NextResponse.json({
    commits: graph,
    count: graph.length,
    hasMore,
    nextTips,
    nextOffset,
    /** True when the result is a filtered view rather than the whole graph. */
    searching,
    /** Set when the query resolved to a single commit rather than a text match. */
    directHit: directHit ? true : undefined,
    currentBranch,
    mainBranch,
    mainShort,
    aheadMain,
    behindMain,
    onMain,
    mergedIntoMain,
    /** merge-base(HEAD, main) — the commit this branch came off. */
    forkBase: forkBaseHash ? { hash: forkBaseHash, shortHash: forkBaseHash.slice(0, 7) } : null,
    /** Local commits not on main yet (capped at 300). */
    aheadOfMain,
  });
}
