import { repoGitReflog } from "../../../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../../../lib/actions/http";
import { runGitRepoAsync } from "../../../../../../lib/git/repo-local";
import { dedupeConsecutive, markUnreachable, parseReflog } from "../../../../../../lib/repos/reflog-parsers";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

/**
 * The reflog, with each entry marked as reachable or not.
 *
 * Reachability is the useful distinction: a commit still reachable from a ref
 * can be found in the history view, while an unreachable one exists only here,
 * and only until git's gc prunes it. That is precisely the "I reset too far"
 * case this exists to rescue, so it is worth the second subprocess.
 */
export async function GET(req: Request, { params }: RepoParams) {
  const { name } = await params;
  return httpAction(repoGitReflog, {
    input: () => ({ name, limit: new URL(req.url).searchParams.get("limit") ?? "100" }),
    context: () => ({ read: async (repo, limit) => {
      const response = await readReflog(repo, limit);
      return { status: response.status, body: await response.json() };
    } }),
    response: (result) => Response.json(result.body, { status: result.status }),
  })(req);
}

async function readReflog(name: string, limit: number) {
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;

  const [reflog, reachable] = await Promise.all([
    runGitRepoAsync(resolved.repoRoot, [
      "reflog",
      `--max-count=${limit}`,
      "--format=%x1e%H%x00%h%x00%gd%x00%gs%x00%gr",
    ]),
    // Every commit reachable from any ref. Compared by hash below, so an entry
    // missing from this set is one only the reflog still knows about.
    runGitRepoAsync(resolved.repoRoot, ["rev-list", "--all", `--max-count=${limit * 20}`]),
  ]);
  if (reflog.status !== 0) return gitFail(reflog, "Reflog failed");

  const reachableSet = new Set(
    reachable.status === 0 ? reachable.stdout.split("\n").map((l) => l.trim()).filter(Boolean) : [],
  );
  const entries = markUnreachable(dedupeConsecutive(parseReflog(reflog.stdout || "")), reachableSet);

  return Response.json({
    entries,
    count: entries.length,
    unreachableCount: entries.filter((e) => e.unreachable).length,
    // False when rev-list failed, so the UI can avoid claiming everything is
    // lost on the strength of a subprocess that did not run.
    reachabilityKnown: reachable.status === 0,
  });
}
