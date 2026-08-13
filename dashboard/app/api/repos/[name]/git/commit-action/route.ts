import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { detectUnmergedFiles } from "@/lib/git/conflicts";
import { isSafeCommitRef } from "@/lib/git/ref-safety";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import type { StashConflictPayload } from "@/app/repos/types";
import { isSafeBranchName } from "../../branches/parsers";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

const BodySchema = z.object({
  action: z.enum([
    "cherry-pick",
    "revert",
    "tag",
    "checkout-detached",
    "reset-to-commit",
    "branch-from-commit",
  ]),
  commit: z.string().min(1).max(128),
  name: z.string().min(1).max(255).optional(),
});

function backupBranchName(): string {
  return `devhub/backup-${new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "")
    .replace("T", "-")}`;
}

function operationConflict(
  action: "cherry-pick" | "revert",
  repoRoot: string,
  error: string,
): NextResponse {
  const payload: StashConflictPayload = {
    code: "stash_conflict",
    action,
    switched: false,
    conflictFiles: detectUnmergedFiles(repoRoot).map((file) => file.path),
    error,
  };
  return NextResponse.json(payload, { status: 409 });
}

async function requireClean(repoRoot: string): Promise<NextResponse | null> {
  const status = await runGitRepoAsync(repoRoot, ["status", "--porcelain"]);
  if (status.status !== 0) return gitFail(status, "Could not inspect working tree");
  return status.stdout.trim()
    ? NextResponse.json(
        { error: "Working tree is dirty. Commit or stash changes first." },
        { status: 400 },
      )
    : null;
}

export async function POST(req: NextRequest, { params }: RepoParams) {
  const { name: repoName } = await params;
  const resolved = withScannedRepo(repoName);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const { action, commit, name } = parsed.data;
  if (!isSafeCommitRef(commit)) {
    return NextResponse.json({ error: "Invalid commit" }, { status: 400 });
  }

  const exists = await runGitRepoAsync(repoRoot, ["rev-parse", "--verify", `${commit}^{commit}`]);
  if (exists.status !== 0) return NextResponse.json({ error: "Commit not found" }, { status: 404 });

  if (action === "tag" || action === "branch-from-commit") {
    if (!name || !isSafeBranchName(name)) {
      return NextResponse.json({ error: `Invalid ${action === "tag" ? "tag" : "branch"} name` }, { status: 400 });
    }
    const refType = action === "tag" ? "tags" : "heads";
    const validRef = await runGitRepoAsync(repoRoot, ["check-ref-format", `refs/${refType}/${name}`]);
    if (validRef.status !== 0) {
      return NextResponse.json({ error: `Invalid ${action === "tag" ? "tag" : "branch"} name` }, { status: 400 });
    }
    const result = await runGitRepoAsync(
      repoRoot,
      action === "tag" ? ["tag", name, commit] : ["branch", name, commit],
    );
    if (result.status !== 0) return gitFail(result, `${action === "tag" ? "Tag" : "Branch"} failed`);
    return NextResponse.json({ ok: true, action, commit, name });
  }

  const dirty = await requireClean(repoRoot);
  if (dirty) return dirty;

  if (action === "cherry-pick" || action === "revert") {
    const parents = await runGitRepoAsync(repoRoot, ["show", "-s", "--format=%P", commit]);
    if (parents.status !== 0) return gitFail(parents, "Could not inspect commit parents");
    if (parents.stdout.trim().split(/\s+/).filter(Boolean).length > 1) {
      return NextResponse.json(
        { error: `${action === "revert" ? "Reverting" : "Cherry-picking"} a merge commit requires choosing a mainline parent.` },
        { status: 400 },
      );
    }
    const result = await runGitRepoAsync(
      repoRoot,
      action === "cherry-pick" ? ["cherry-pick", commit] : ["revert", "--no-edit", commit],
      { timeout: 120_000 },
    );
    if (result.status !== 0) {
      const error = result.stderr.trim() || result.stdout.trim() || `${action} failed`;
      if (detectUnmergedFiles(repoRoot).length > 0 || /conflict/i.test(error)) {
        return operationConflict(action, repoRoot, error);
      }
      return gitFail(result, `${action} failed`);
    }
    return NextResponse.json({ ok: true, action, commit });
  }

  if (action === "checkout-detached") {
    const result = await runGitRepoAsync(repoRoot, ["checkout", "--detach", commit]);
    if (result.status !== 0) return gitFail(result, "Detached checkout failed");
    return NextResponse.json({ ok: true, action, commit });
  }

  const current = await runGitRepoAsync(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (current.status !== 0 || current.stdout.trim() === "HEAD") {
    return NextResponse.json({ error: "Cannot reset a detached HEAD" }, { status: 400 });
  }
  const backupBranch = backupBranchName();
  const backup = await runGitRepoAsync(repoRoot, ["branch", backupBranch, "HEAD"]);
  if (backup.status !== 0) {
    return gitFail(backup, "Could not create backup branch; reset cancelled");
  }
  const result = await runGitRepoAsync(repoRoot, ["reset", "--hard", commit]);
  if (result.status !== 0) return gitFail(result, "Reset failed");
  return NextResponse.json({
    ok: true,
    action,
    commit,
    backupBranch,
  });
}
