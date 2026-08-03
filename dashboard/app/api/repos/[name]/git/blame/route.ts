import fs from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { isSafeCommitRef, isSafeRepoRelPath } from "@/lib/git/ref-safety";
import { parseBlamePorcelain, parseFileHistory } from "@/lib/repos/git-parsers";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

/** Conventional path git itself documents for blame.ignoreRevsFile. */
const IGNORE_REVS_FILE = ".git-blame-ignore-revs";

/**
 * Repo-local ignore-revs file, when the project ships one.
 *
 * Without this a single "format the codebase" commit owns every line and blame
 * is useless on exactly the repos that need it most.
 */
function ignoreRevsArgs(repoRoot: string, enabled: boolean): string[] {
  if (!enabled) return [];
  const file = path.join(repoRoot, IGNORE_REVS_FILE);
  return fs.existsSync(file) ? ["--ignore-revs-file", IGNORE_REVS_FILE] : [];
}

/**
 * Blame a file (optionally at a revision). Pass `line` to also return
 * line-scoped history via `git log -L` for drill-down.
 */
export async function GET(req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const filePath = req.nextUrl.searchParams.get("path");
  if (!filePath || !isSafeRepoRelPath(filePath)) {
    return NextResponse.json({ error: "Valid path required" }, { status: 400 });
  }

  const commitRaw = req.nextUrl.searchParams.get("commit")?.trim() || "";
  const commit = commitRaw && isSafeCommitRef(commitRaw) ? commitRaw : null;
  if (commitRaw && !commit) {
    return NextResponse.json({ error: "Invalid commit" }, { status: 400 });
  }

  const lineRaw = req.nextUrl.searchParams.get("line");
  const line = lineRaw ? Number(lineRaw) : null;
  if (lineRaw && (!Number.isInteger(line) || (line ?? 0) < 1)) {
    return NextResponse.json({ error: "Invalid line" }, { status: 400 });
  }

  // Default on — matching a repo's stated intent is the sane default; the UI
  // toggle exists for "who actually touched this line, formatter included".
  const useIgnoreRevs = req.nextUrl.searchParams.get("ignoreRevs") !== "0";
  const ignoreArgs = ignoreRevsArgs(repoRoot, useIgnoreRevs);

  const blameArgs = ["blame", "--line-porcelain", ...ignoreArgs];
  if (commit) blameArgs.push(commit);
  blameArgs.push("--", filePath);

  const historyArgs = line
    ? [
        "log",
        ...(commit ? [commit] : []),
        "-L",
        `${line},${line}:${filePath}`,
        "-s",
        "--max-count=30",
        "--pretty=format:%x1e%H%x00%h%x00%s%x00%an%x00%ar",
      ]
    : [
        "log",
        "--max-count=30",
        "--format=%x1e%H%x00%h%x00%s%x00%an%x00%ar",
        ...(commit ? [commit] : []),
        "--",
        filePath,
      ];

  const [blame, history] = await Promise.all([
    runGitRepoAsync(repoRoot, blameArgs, { timeout: 30_000 }),
    runGitRepoAsync(repoRoot, historyArgs, { timeout: 30_000 }),
  ]);

  if (blame.status !== 0) return gitFail(blame, "Blame failed");
  // Line history can fail on renames / binary; still return blame lines.
  const historyOk = history.status === 0;

  return NextResponse.json({
    path: filePath,
    commit: commit ?? null,
    line: line ?? null,
    lines: parseBlamePorcelain(blame.stdout || ""),
    history: historyOk ? parseFileHistory(history.stdout || "") : [],
    historyScope: line ? "line" : "file",
    /** Whether this repo ships an ignore-revs file at all — drives the toggle. */
    hasIgnoreRevs: fs.existsSync(path.join(repoRoot, IGNORE_REVS_FILE)),
    ignoringRevs: ignoreArgs.length > 0,
  });
}
