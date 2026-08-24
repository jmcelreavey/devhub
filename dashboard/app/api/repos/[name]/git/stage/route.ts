import { NextResponse, type NextRequest } from "next/server";
import { detectUnmergedFiles } from "@/lib/git/conflicts";
import { discardGitPaths, type DiscardScope } from "@/lib/git/discard";
import { stageDiffHunk } from "@/lib/git/patch-stage";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

/**
 * Unstage / discard are not git operations on a conflicted path — the index
 * holds stage1/2/3 entries until the file is staged (resolved). `git restore
 * --staged` fails on them with a raw "is unmerged" error per path, which read
 * like five unrelated bugs. Catch it upfront and say what to do instead.
 */
function unmergedGuard(repoRoot: string, paths: string[]): NextResponse | null {
  if (paths.length === 0) return null;
  const unmerged = new Set(detectUnmergedFiles(repoRoot).map((f) => f.path));
  const hit = paths.filter((p) => unmerged.has(p));
  if (hit.length === 0) return null;
  const names = hit.slice(0, 3).join(", ");
  return NextResponse.json(
    {
      code: "unmerged",
      conflictFiles: hit,
      error:
        `${hit.length} path${hit.length === 1 ? " is" : "s are"} still in conflict (${names}${hit.length > 3 ? "…" : ""}). ` +
        "Resolve them in the Conflicts tab (or stage to mark resolved) — unstaging a conflicted file would re-create the conflict.",
    },
    { status: 409 },
  );
}

export async function POST(req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    path?: string;
    paths?: string[];
    /** staged = discard index hunks (keep unstaged); unstaged = discard worktree only */
    scope?: DiscardScope;
    /** For stage-hunk / unstage-hunk */
    rawDiff?: string;
    hunkIndex?: number;
    lineIndexes?: number[];
  };

  const paths = [
    ...(typeof body.path === "string" && body.path ? [body.path] : []),
    ...(Array.isArray(body.paths) ? body.paths.filter((p): p is string => typeof p === "string") : []),
  ];

  if (paths.some((p) => p.includes("..") || p.startsWith("/"))) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  switch (body.action) {
    case "stage": {
      if (paths.length === 0) {
        const out = await runGitRepoAsync(repoRoot, ["add", "-A"]);
        if (out.status !== 0) return gitFail(out, "Stage failed");
        return NextResponse.json({ ok: true });
      }
      const out = await runGitRepoAsync(repoRoot, ["add", "--", ...paths]);
      if (out.status !== 0) return gitFail(out, "Stage failed");
      return NextResponse.json({ ok: true });
    }
    case "unstage": {
      if (paths.length === 0) {
        const out = await runGitRepoAsync(repoRoot, ["reset", "HEAD"]);
        if (out.status !== 0) return gitFail(out, "Unstage failed");
        return NextResponse.json({ ok: true });
      }
      const blocked = unmergedGuard(repoRoot, paths);
      if (blocked) return blocked;
      const out = await runGitRepoAsync(repoRoot, ["restore", "--staged", "--", ...paths]);
      if (out.status !== 0) return gitFail(out, "Unstage failed");
      return NextResponse.json({ ok: true });
    }
    case "discard": {
      if (paths.length === 0) {
        return NextResponse.json({ error: "path required for discard" }, { status: 400 });
      }
      const blocked = unmergedGuard(repoRoot, paths);
      if (blocked) return blocked;
      const scope: DiscardScope =
        body.scope === "staged" || body.scope === "unstaged" ? body.scope : "unstaged";
      const result = await discardGitPaths(repoRoot, paths, scope);
      if (!result.ok) {
        return NextResponse.json({ error: result.error || "Discard failed" }, { status: 500 });
      }
      return NextResponse.json({ ok: true, scope });
    }
    case "stage-hunk":
    case "unstage-hunk": {
      const filePath = paths[0];
      if (!filePath) {
        return NextResponse.json({ error: "path required for hunk staging" }, { status: 400 });
      }
      if (typeof body.rawDiff !== "string" || !body.rawDiff.trim()) {
        return NextResponse.json({ error: "rawDiff required" }, { status: 400 });
      }
      if (typeof body.hunkIndex !== "number" || body.hunkIndex < 0) {
        return NextResponse.json({ error: "hunkIndex required" }, { status: 400 });
      }
      const lineIndexes = Array.isArray(body.lineIndexes)
        ? body.lineIndexes.filter((n): n is number => typeof n === "number" && n > 0)
        : undefined;
      const result = await stageDiffHunk({
        repoRoot,
        rawDiff: body.rawDiff,
        filePath,
        hunkIndex: body.hunkIndex,
        lineIndexes: lineIndexes && lineIndexes.length > 0 ? lineIndexes : undefined,
        reverse: body.action === "unstage-hunk",
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }
}
