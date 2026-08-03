import { NextResponse, type NextRequest } from "next/server";
import { resolveDefaultRemoteBranch, runGitRepoAsync } from "@/lib/git/repo-local";
import { isSafeRepoRelPath } from "@/lib/git/ref-safety";
import { parseUnifiedDiff } from "@/lib/repos/git-parsers";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

/**
 * Diff a whole range — "what does this branch change vs main" — rather than a
 * single commit. History already answers "what did this commit do"; this is the
 * review-shaped question that needed a second endpoint.
 */

/** Branch/tag names as well as SHAs, since a range is usually `main...feature`. */
const REF_RE = /^[0-9A-Za-z._\-/]{1,200}$/;

function isSafeRangeRef(ref: string): boolean {
  if (!ref || !REF_RE.test(ref)) return false;
  // `..`/`...` are the range operators; a ref containing them would let the
  // caller smuggle a second range in. Also blocks the `.lock`-style traversals.
  if (ref.includes("..")) return false;
  return !ref.startsWith("-") && !ref.endsWith("/");
}

function parseUnifiedContext(raw: string | null, full: boolean): number {
  if (full) return 999_999;
  if (raw == null || raw === "") return 3;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 3;
  return Math.min(999_999, Math.max(0, Math.floor(n)));
}

function parseNameStatus(stdout: string): { path: string; status: string }[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      if (tab < 0) return { status: "M", path: line };
      const parts = line.slice(tab + 1).split("\t");
      return {
        status: line.slice(0, tab).trim(),
        path: (parts[parts.length - 1] || "").trim(),
      };
    })
    .filter((f) => f.path);
}

export async function GET(req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const headParam = req.nextUrl.searchParams.get("head")?.trim() || "HEAD";
  let baseParam = req.nextUrl.searchParams.get("base")?.trim() || "";
  if (!baseParam) {
    // Default to the repo's own trunk rather than assuming "main".
    baseParam = (await resolveDefaultRemoteBranch(repoRoot)) ?? "origin/main";
  }
  if (!isSafeRangeRef(headParam) || !isSafeRangeRef(baseParam)) {
    return NextResponse.json({ error: "Invalid ref" }, { status: 400 });
  }

  const filePath = req.nextUrl.searchParams.get("path");
  if (filePath && !isSafeRepoRelPath(filePath)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const unified = parseUnifiedContext(
    req.nextUrl.searchParams.get("context"),
    req.nextUrl.searchParams.get("full") === "1",
  );

  // Merge-base range (`...`): shows what HEAD added, not what it's missing from
  // base. That's what a reviewer means by "the changes on this branch".
  const range = `${baseParam}...${headParam}`;

  const [files, counts, diff] = await Promise.all([
    runGitRepoAsync(repoRoot, ["diff", "--name-status", range], { timeout: 30_000 }),
    runGitRepoAsync(repoRoot, ["rev-list", "--left-right", "--count", range], { timeout: 30_000 }),
    runGitRepoAsync(
      repoRoot,
      [
        "diff",
        `-U${unified}`,
        range,
        ...(filePath ? ["--", filePath] : []),
      ],
      { timeout: 30_000 },
    ),
  ]);

  if (files.status !== 0) return gitFail(files, "Range diff failed");

  const [behind = "0", ahead = "0"] = (counts.stdout || "").trim().split(/\s+/);

  return NextResponse.json({
    base: baseParam,
    head: headParam,
    behind: Number(behind) || 0,
    ahead: Number(ahead) || 0,
    files: parseNameStatus(files.stdout || ""),
    path: filePath ?? null,
    lines: diff.status === 0 ? parseUnifiedDiff(diff.stdout || "") : [],
  });
}
