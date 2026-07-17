import { NextResponse, type NextRequest } from "next/server";
import { detectUnmergedFiles } from "@/lib/git-conflicts";
import {
  formatIndexLockError,
  looksLikeIndexLockError,
  prepareGitIndexWrite,
} from "@/lib/git-index-lock";
import { runGitRepoAsync } from "@/lib/git-repo-local";
import { parseStashList, parseUnifiedDiff } from "@/lib/repo-git-parsers";
import type { StashConflictPayload } from "@/app/repos/types";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

function indexLockResponse(repoRoot: string, gitError?: string): NextResponse {
  return NextResponse.json(
    { error: formatIndexLockError(repoRoot, gitError), code: "index_lock" as const },
    { status: 409 },
  );
}

function looksLikeConflict(stderr: string, stdout: string): boolean {
  const text = `${stderr}\n${stdout}`;
  return /conflict/i.test(text) || /unmerged paths/i.test(text);
}

function stashConflict(
  action: StashConflictPayload["action"],
  repoRoot: string,
  gitError: string,
): NextResponse {
  const payload: StashConflictPayload = {
    code: "stash_conflict",
    action,
    switched: false,
    conflictFiles: detectUnmergedFiles(repoRoot).map((f) => f.path),
    error: gitError || "Stash left conflicts",
  };
  return NextResponse.json(payload, { status: 409 });
}

function normalizeRef(ref?: string): string {
  if (!ref || typeof ref !== "string") return "stash@{0}";
  if (/^stash@\{\d+\}$/.test(ref)) return ref;
  if (/^\d+$/.test(ref)) return `stash@{${ref}}`;
  return ref;
}

export async function GET(_req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;

  const list = await runGitRepoAsync(resolved.repoRoot, ["stash", "list", "--format=%gd%x00%gs"]);
  if (list.status !== 0) return gitFail(list, "Stash list failed");

  return NextResponse.json({ stashes: parseStashList(list.stdout || "") });
}

export async function POST(req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    ref?: string;
    message?: string;
  };
  const ref = normalizeRef(body.ref);

  switch (body.action) {
    case "save": {
      const prep = prepareGitIndexWrite(repoRoot);
      if (!prep.ok) return indexLockResponse(repoRoot, prep.error);

      const args = ["stash", "push", "--include-untracked"];
      if (body.message?.trim()) args.push("-m", body.message.trim());
      const out = await runGitRepoAsync(repoRoot, args);
      if (out.status !== 0) {
        const gitError = out.stderr.trim() || out.stdout.trim() || "Stash save failed";
        if (looksLikeIndexLockError(out.stderr, out.stdout)) {
          return indexLockResponse(repoRoot, gitError);
        }
        return NextResponse.json({ error: gitError }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }
    case "apply":
    case "pop": {
      const out = await runGitRepoAsync(repoRoot, ["stash", body.action, ref]);
      if (out.status !== 0) {
        const gitError = out.stderr.trim() || out.stdout.trim() || `Stash ${body.action} failed`;
        if (detectUnmergedFiles(repoRoot).length > 0 || looksLikeConflict(out.stderr, out.stdout)) {
          return stashConflict("stash-apply", repoRoot, gitError);
        }
        return NextResponse.json({ error: gitError }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }
    case "drop": {
      const out = await runGitRepoAsync(repoRoot, ["stash", "drop", ref]);
      if (out.status !== 0) return gitFail(out, "Stash drop failed");
      return NextResponse.json({ ok: true });
    }
    case "show": {
      const out = await runGitRepoAsync(repoRoot, ["stash", "show", "-p", "--stat", ref]);
      if (out.status !== 0) return gitFail(out, "Stash show failed");
      const raw = out.stdout || "";
      return NextResponse.json({ ref, raw, lines: parseUnifiedDiff(raw), empty: !raw.trim() });
    }
    default:
      return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }
}
