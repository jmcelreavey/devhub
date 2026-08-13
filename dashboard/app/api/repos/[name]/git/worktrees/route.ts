import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { isSafeBranchName } from "../../branches/parsers";
import {
  defaultWorktreePath,
  parseWorktreeList,
  worktreePathError,
} from "@/lib/repos/worktree-parsers";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

/** The repo's worktrees, main one first. */
export async function GET(_req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;

  const list = await runGitRepoAsync(resolved.repoRoot, ["worktree", "list", "--porcelain"]);
  if (list.status !== 0) return gitFail(list, "Could not list worktrees");

  const worktrees = parseWorktreeList(list.stdout || "");
  return NextResponse.json({
    worktrees,
    // The client derives the suggested path for a new worktree from this, so
    // the rule lives in one place shared by both sides.
    repoRoot: resolved.repoRoot,
    count: worktrees.length,
  });
}

const BodySchema = z.object({
  action: z.enum(["add", "remove", "prune", "lock", "unlock"]),
  /** Existing branch to check out, or the name to create with `createBranch`. */
  branch: z.string().min(1).max(255).optional(),
  /** Target directory for `add`, or the worktree to act on for the rest. */
  path: z.string().min(1).max(4096).optional(),
  /** Create `branch` rather than checking out an existing one. */
  createBranch: z.boolean().optional(),
  /** Remove a worktree with uncommitted changes. */
  force: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: RepoParams) {
  const { name } = await params;
  const resolved = withScannedRepo(name);
  if (!resolved.ok) return resolved.response;

  const body = await parseBody(req, BodySchema);
  if (!body.ok) return body.response;
  const { action, branch, createBranch, force } = body.data;
  const rp = resolved.repoRoot;

  switch (action) {
    case "add": {
      if (!branch || !isSafeBranchName(branch)) {
        return NextResponse.json({ error: "Invalid branch name" }, { status: 400 });
      }
      const target = body.data.path?.trim() || defaultWorktreePath(rp, branch);
      const pathError = worktreePathError(rp, target);
      if (pathError) return NextResponse.json({ error: pathError }, { status: 400 });

      // `-b` creates the branch, plain add checks out an existing one. Getting
      // this the wrong way round either clobbers a branch or fails outright, so
      // the caller states which it means rather than us guessing from existence.
      const args = createBranch
        ? ["worktree", "add", "-b", branch, target]
        : ["worktree", "add", target, branch];
      const result = await runGitRepoAsync(rp, args, { timeout: 120_000 });
      if (result.status !== 0) return gitFail(result, "Could not create the worktree");
      return NextResponse.json({ ok: true, path: target, branch });
    }

    case "remove": {
      const target = body.data.path?.trim();
      if (!target) return NextResponse.json({ error: "No worktree given" }, { status: 400 });
      // Refuse the main working tree here rather than letting git refuse it, so
      // the message names the reason.
      if (target.replace(/\/+$/, "") === rp.replace(/\/+$/, "")) {
        return NextResponse.json(
          { error: "That is the repository's own working tree and cannot be removed." },
          { status: 400 },
        );
      }
      const result = await runGitRepoAsync(rp, [
        "worktree",
        "remove",
        ...(force ? ["--force"] : []),
        target,
      ]);
      if (result.status !== 0) {
        // Git refuses a dirty worktree by default. Surfacing that as a distinct
        // code lets the UI offer force rather than just reporting failure.
        const dirty = /contains modified or untracked files/i.test(result.stderr);
        return NextResponse.json(
          {
            error: result.stderr.trim() || "Could not remove the worktree",
            code: dirty ? "worktree_dirty" : undefined,
          },
          { status: dirty ? 409 : 500 },
        );
      }
      return NextResponse.json({ ok: true });
    }

    case "prune": {
      // Clears administrative entries for worktrees whose directory is gone.
      const result = await runGitRepoAsync(rp, ["worktree", "prune", "-v"]);
      if (result.status !== 0) return gitFail(result, "Could not prune worktrees");
      return NextResponse.json({ ok: true, message: result.stdout.trim() || undefined });
    }

    case "lock":
    case "unlock": {
      const target = body.data.path?.trim();
      if (!target) return NextResponse.json({ error: "No worktree given" }, { status: 400 });
      const result = await runGitRepoAsync(rp, ["worktree", action, target]);
      if (result.status !== 0) return gitFail(result, `Could not ${action} the worktree`);
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
