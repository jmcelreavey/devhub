import { repoGitShow, repoGitShowDashboard } from "../../../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../../../lib/actions/http";
import { runGitRepoAsync } from "../../../../../../lib/git/repo-local";
import { isSafeCommitRef } from "../../../../../../lib/git/ref-safety";
import { parseNameStatus, parseUnifiedContext, parseUnifiedDiff } from "../../../../../../../../../packages/shared/ui-lib/repos/git-parsers";
import { gitFail, repoDashboardQueryHttp, withScannedRepo, type RepoParams } from "../_shared";

export async function GET(req: Request, routeParams: RepoParams) {
  const { name } = await routeParams.params;
  const search = new URL(req.url).searchParams;
  const input = {
    name,
    ref: (search.get("commit") || search.get("ref") || search.get("hash") || "").trim(),
    path: search.get("path") ?? undefined,
  };
  const allowed = new Set(["commit", "ref", "hash", "path"]);
  if ([...search.keys()].every((key) => allowed.has(key))) {
    return httpAction(repoGitShow, {
      input: () => input,
      context: () => ({ show: async () => {
        const response = await readRepoGitShow(req, routeParams);
        return { status: response.status, body: await response.json() };
      } }),
      response: (result) => Response.json(result.body, { status: result.status }),
    })(req);
  }
  return repoDashboardQueryHttp(repoGitShowDashboard, req, routeParams, readRepoGitShow);
}

async function readRepoGitShow(req: Request, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const commit = (
    new URL(req.url).searchParams.get("commit") ||
    new URL(req.url).searchParams.get("ref") ||
    new URL(req.url).searchParams.get("hash") ||
    ""
  ).trim();
  const filePath = new URL(req.url).searchParams.get("path");
  const unified = parseUnifiedContext(
    new URL(req.url).searchParams.get("context"),
    new URL(req.url).searchParams.get("full") === "1",
  );

  if (!commit || !isSafeCommitRef(commit)) {
    return Response.json({ error: "Invalid commit" }, { status: 400 });
  }
  if (filePath && (filePath.includes("..") || filePath.startsWith("/") || filePath.includes("\0"))) {
    return Response.json({ error: "Invalid path" }, { status: 400 });
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

  if (new URL(req.url).searchParams.get("format") === "patch") {
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
    return Response.json({
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

  return Response.json({
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
