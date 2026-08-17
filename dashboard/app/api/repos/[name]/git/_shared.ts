import { NextResponse } from "next/server";
import { detectUnmergedFiles } from "@/lib/git/conflicts";
import { resolveScannedRepo } from "@/lib/scanned-repo";
import type { StashConflictPayload } from "@/app/repos/types";

export type RepoParams = { params: Promise<{ name: string }> };

export function withScannedRepo(
  name: string,
): { ok: true; repoRoot: string } | { ok: false; response: NextResponse } {
  const repoRoot = resolveScannedRepo(name);
  if (!repoRoot) {
    return { ok: false, response: NextResponse.json({ error: "Unknown repo" }, { status: 404 }) };
  }
  return { ok: true, repoRoot };
}

export function gitFail(result: { stderr: string; stdout: string }, fallback: string) {
  return NextResponse.json(
    { error: result.stderr.trim() || result.stdout.trim() || fallback },
    { status: 500 },
  );
}

/**
 * Timestamped `devhub/backup-*` ref, taken before anything that rewrites the
 * branch pointer. Cheaper to reason about than reflog archaeology.
 */
export function backupBranchName(): string {
  return `devhub/backup-${new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "")
    .replace("T", "-")}`;
}

export function looksLikeStashConflict(stderr: string, stdout: string): boolean {
  const text = `${stderr}\n${stdout}`;
  return /conflict/i.test(text) || /unmerged paths/i.test(text);
}

export function stashConflictResponse(
  action: StashConflictPayload["action"],
  repoRoot: string,
  gitError: string,
  extras: { branch?: string; switched: boolean; syncTarget?: string; stashed?: boolean },
): NextResponse {
  const conflictFiles = detectUnmergedFiles(repoRoot).map((f) => f.path);
  const payload: StashConflictPayload = {
    code: "stash_conflict",
    action,
    branch: extras.branch,
    switched: extras.switched,
    conflictFiles,
    error: gitError || "Stash apply left conflicts",
    syncTarget: extras.syncTarget,
    stashed: extras.stashed,
  };
  return NextResponse.json(payload, { status: 409 });
}

/**
 * Stash pop/apply (and merge/rebase that leave unmerged paths) share the same
 * 409-vs-500 fork: conflicts belong in the Conflicts tab; anything else is a
 * plain failure. Five call sites were copy-pasting this.
 */
export function stashPopFailure(
  action: StashConflictPayload["action"],
  repoRoot: string,
  result: { stderr: string; stdout: string },
  extras: { branch?: string; switched: boolean; syncTarget?: string; stashed?: boolean },
  fallback: string,
): NextResponse {
  const gitError = result.stderr.trim() || result.stdout.trim() || fallback;
  if (detectUnmergedFiles(repoRoot).length > 0 || looksLikeStashConflict(result.stderr, result.stdout)) {
    return stashConflictResponse(action, repoRoot, gitError, extras);
  }
  return gitFail(result, fallback);
}
