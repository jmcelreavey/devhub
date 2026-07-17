import { NextResponse, type NextRequest } from "next/server";
import { discardGitPaths, type DiscardScope } from "@/lib/git-discard";
import { stageDiffHunk } from "@/lib/git-patch-stage";
import { runGitRepoAsync } from "@/lib/git-repo-local";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

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
      const out = await runGitRepoAsync(repoRoot, ["restore", "--staged", "--", ...paths]);
      if (out.status !== 0) return gitFail(out, "Unstage failed");
      return NextResponse.json({ ok: true });
    }
    case "discard": {
      if (paths.length === 0) {
        return NextResponse.json({ error: "path required for discard" }, { status: 400 });
      }
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
