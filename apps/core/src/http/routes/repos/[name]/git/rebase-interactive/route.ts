import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { z } from "zod";
import { repoGitInteractiveRebase, repoGitInteractiveRebaseInput } from "../../../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../../../lib/actions/http";
import { parseBody } from "../../../../../../lib/api-utils";
import { detectUnmergedFiles } from "../../../../../../lib/git/conflicts";
import { buildRebaseTodo } from "../../../../../../lib/git/rebase-todo";
import { isSafeCommitRef } from "../../../../../../lib/git/ref-safety";
import { runGitRepoAsync } from "../../../../../../lib/git/repo-local";
import type { StashConflictPayload } from "../../../../../../../../../packages/shared/repos/types";
import { gitFail, withScannedRepo, type RepoParams } from "../_shared";

const BodySchema = repoGitInteractiveRebaseInput.omit({ repo: true });

async function rebaseConflict(repoRoot: string, error: string): Promise<Response> {
  const payload: StashConflictPayload = {
    code: "stash_conflict",
    action: "rebase",
    switched: false,
    conflictFiles: (await detectUnmergedFiles(repoRoot)).map((file) => file.path),
    error,
  };
  return Response.json(payload, { status: 409 });
}

/**
 * Scripted interactive rebase.
 *
 * The plan is applied through a generated todo file; `sequence.editor` is a
 * shell snippet that overwrites the todo with our content and `core.editor`
 * is `true`, so no editor ever opens and no TTY is needed. Reword/squash
 * messages ride along as `exec git commit --amend -F <file>` lines the
 * builder emits.
 */
export async function POST(req: Request, { params }: RepoParams) {
  const { name: repoName } = await params;
  const resolved = withScannedRepo(repoName);
  if (!resolved.ok) return resolved.response;
  const { repoRoot } = resolved;

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  return httpAction(repoGitInteractiveRebase, {
    input: () => ({ repo: repoName, ...parsed.data }),
    context: () => ({ rebase: async (input) => {
      const response = await applyRebase(repoRoot, input);
      return { status: response.status, body: await response.json() };
    } }),
    response: (result) => Response.json(result.body, { status: result.status }),
  })(req);
}

async function applyRebase(repoRoot: string, { base, steps }: z.output<typeof BodySchema>) {
  if (!isSafeCommitRef(base)) {
    return Response.json({ error: "Invalid base commit" }, { status: 400 });
  }
  for (const step of steps) {
    if (!isSafeCommitRef(step.commit)) {
      return Response.json({ error: `Invalid commit ref in plan: ${step.commit}` }, { status: 400 });
    }
  }

  const headBranch = await runGitRepoAsync(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (headBranch.status !== 0 || headBranch.stdout.trim() === "HEAD") {
    return Response.json(
      { error: "Rebase needs a checked-out branch — HEAD is detached." },
      { status: 400 },
    );
  }

  const baseVerify = await runGitRepoAsync(repoRoot, ["rev-parse", "--verify", `${base}^{commit}`]);
  if (baseVerify.status !== 0) {
    return Response.json({ error: "Base commit not found" }, { status: 404 });
  }
  const ancestor = await runGitRepoAsync(repoRoot, [
    "merge-base",
    "--is-ancestor",
    base,
    "HEAD",
  ]);
  if (ancestor.status !== 0) {
    return Response.json(
      { error: "Base commit is not an ancestor of HEAD — it must be inside this branch's history." },
      { status: 400 },
    );
  }

  const dirty = await runGitRepoAsync(repoRoot, ["status", "--porcelain"]);
  if (dirty.status !== 0) return gitFail(dirty, "Could not inspect working tree");
  if (dirty.stdout.trim()) {
    return Response.json(
      { error: "Working tree is dirty. Commit or stash changes before rewriting history." },
      { status: 400 },
    );
  }

  // Message files live in one temp dir; the todo references them by absolute path.
  let dir: string | null = null;
  try {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "devhub-rebase-"));
    const messagePath = (sha: string) => path.join(dir!, `msg-${sha}`);
    for (const step of steps) {
      if (step.message !== undefined && step.message.trim()) {
        await fs.promises.writeFile(messagePath(step.commit.trim()), `${step.message.trim()}\n`);
      }
    }

    const todo = buildRebaseTodo(steps, messagePath);
    if (!todo.ok) return Response.json({ error: todo.error }, { status: 400 });

    const editorScript = path.join(dir, "sequence-editor.sh");
    await fs.promises.writeFile(
      editorScript,
      `#!/bin/sh\ncat > "$1" <<'DEVHUB_TODO_EOF'\n${todo.todo}DEVHUB_TODO_EOF\n`,
      { mode: 0o700 },
    );

    const result = await runGitRepoAsync(repoRoot, [
      "-c",
      `sequence.editor=${editorScript}`,
      "-c",
      "core.editor=true",
      "rebase",
      "-i",
      baseVerify.stdout.trim(),
    ], { timeout: 300_000 });

    if (result.status !== 0) {
      const error = result.stderr.trim() || result.stdout.trim() || "Interactive rebase failed";
      if ((await detectUnmergedFiles(repoRoot)).length > 0 || /conflict|could not apply/i.test(error)) {
        return rebaseConflict(repoRoot, error);
      }
      return gitFail(result, "Interactive rebase failed");
    }
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not stage the rebase plan" },
      { status: 500 },
    );
  } finally {
    if (dir) await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
