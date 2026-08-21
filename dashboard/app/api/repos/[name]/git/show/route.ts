import { NextResponse, type NextRequest } from "next/server";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { isSafeCommitRef } from "@/lib/git/ref-safety";
import { parseNameStatus, parseUnifiedContext, parseUnifiedDiff } from "@/lib/repos/git-parsers";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

export async function GET(req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const commit = (
    req.nextUrl.searchParams.get("commit") ||
    req.nextUrl.searchParams.get("ref") ||
    req.nextUrl.searchParams.get("hash") ||
    ""
  ).trim();
  const filePath = req.nextUrl.searchParams.get("path");
  const unified = parseUnifiedContext(
    req.nextUrl.searchParams.get("context"),
    req.nextUrl.searchParams.get("full") === "1",
  );

  if (!commit || !isSafeCommitRef(commit)) {
    return NextResponse.json({ error: "Invalid commit" }, { status: 400 });
  }
  if (filePath && (filePath.includes("..") || filePath.startsWith("/") || filePath.includes("\0"))) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const meta = await runGitRepoAsync(repoRoot, [
    "show",
    "-s",
    "--format=%H%x00%h%x00%s%x00%b%x00%an%x00%ae%x00%aI%x00%ar%x00%P%x00%G?",
    commit,
  ]);
  if (meta.status !== 0) return gitFail(meta, "Commit not found");

  const [
    hash = "",
    shortHash = "",
    subject = "",
    body = "",
    author = "",
    authorEmail = "",
    date = "",
    relativeDate = "",
    parentsRaw = "",
    gpg = "",
  ] = (meta.stdout || "").trim().split("\0");

  const parents = parentsRaw.trim() ? parentsRaw.trim().split(/\s+/) : [];

  const names = await runGitRepoAsync(repoRoot, [
    "diff-tree",
    "--no-commit-id",
    "--name-status",
    "-r",
    commit,
  ]);
  if (names.status !== 0) return gitFail(names, "Failed to list changed files");
  const files = parseNameStatus(names.stdout || "");

  if (req.nextUrl.searchParams.get("format") === "patch") {
    const patch = await runGitRepoAsync(repoRoot, [
      "show",
      "--format=",
      "--patch",
      "--find-renames",
      commit,
    ]);
    if (patch.status !== 0 && !(patch.stdout || "").trim()) {
      return gitFail(patch, "Diff failed");
    }
    return NextResponse.json({
      hash,
      shortHash,
      subject,
      patch: patch.stdout || "",
    });
  }

  const selectedPath =
    filePath && files.some((f) => f.path === filePath) ? filePath : (files[0]?.path ?? null);

  let raw = "";
  if (selectedPath) {
    const patch = await runGitRepoAsync(repoRoot, [
      "show",
      "--format=",
      "--patch",
      "--find-renames",
      `-U${unified}`,
      commit,
      "--",
      selectedPath,
    ]);
    if (patch.status !== 0 && !(patch.stdout || "").trim()) {
      return gitFail(patch, "Diff failed");
    }
    raw = patch.stdout || "";
  }

  const head = await runGitRepoAsync(repoRoot, ["rev-parse", "HEAD"]);
  const headHash = head.status === 0 ? (head.stdout || "").trim() : "";
  const isHead = Boolean(headHash && hash && headHash === hash);

  let isAncestorOfHead = false;
  let aheadCount = 0;
  if (headHash && hash && !isHead) {
    const ancestor = await runGitRepoAsync(repoRoot, [
      "merge-base",
      "--is-ancestor",
      hash,
      "HEAD",
    ]);
    if (ancestor.status === 0) {
      isAncestorOfHead = true;
      const count = await runGitRepoAsync(repoRoot, [
        "rev-list",
        "--count",
        `${hash}..HEAD`,
      ]);
      if (count.status === 0) {
        const n = Number((count.stdout || "").trim());
        aheadCount = Number.isFinite(n) ? n : 0;
      }
    }
  }

  return NextResponse.json({
    hash,
    shortHash,
    subject,
    body: body.trim(),
    author,
    authorEmail,
    date,
    relativeDate,
    parents,
    files,
    path: selectedPath,
    raw,
    lines: parseUnifiedDiff(raw),
    empty: !raw.trim(),
    context: unified,
    isHead,
    isAncestorOfHead,
    aheadCount,
    gpg: gpg || undefined,
  });
}
