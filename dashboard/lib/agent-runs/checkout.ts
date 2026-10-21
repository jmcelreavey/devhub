import fs from "node:fs";
import path from "node:path";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { loadPaseoWorktreeActivity } from "@/lib/paseo/workspaces";
import { listRegisteredTerminalSessions } from "@/lib/terminal-sessions-registry";
import { listCapacityRuns } from "./store";

export interface CheckoutPreparation {
  originalBranch: string;
  originalHead: string;
  branch: string;
  stashMessage: string;
  stashSha?: string;
  baseSha?: string;
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, fs.realpathSync(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function assertCheckoutAvailable(root: string, runId: string): Promise<void> {
  if (listCapacityRuns().some((run) => run.spec.id !== runId && inside(root, run.spec.worktree?.path ?? run.spec.cwd))) {
    throw new Error("Another agent is using this checkout. Wait for it or enable an isolated worktree.");
  }
  if (listRegisteredTerminalSessions().some((tab) => tab.status !== "closed" && tab.cwd && inside(root, tab.cwd))) {
    throw new Error("A terminal is using this checkout. Close it or enable an isolated worktree.");
  }
  const activity = await loadPaseoWorktreeActivity({ ignoreIdlePins: true });
  if (activity.some((workspace) => workspace.active && fs.existsSync(workspace.path) && inside(root, workspace.path))) {
    throw new Error("Paseo has active work in this checkout. Wait for it or enable an isolated worktree.");
  }
}

async function git(root: string, args: string[]): Promise<string> {
  const result = await runGitRepoAsync(root, args, { timeout: 60_000, useGhCredentials: ["fetch", "ls-remote"].includes(args[0]) });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout.trim();
}

/** Fresh task launches only. Follow-ups keep their branch, edits and diff baseline. */
export async function prepareImplementationCheckout(cwd: string, runId: string, options: {
  record: (receipt: CheckoutPreparation) => void;
  assertAvailable?: (root: string, runId: string) => Promise<void>;
}): Promise<CheckoutPreparation> {
  const root = fs.realpathSync(await git(cwd, ["rev-parse", "--show-toplevel"]));
  const gitDir = await git(root, ["rev-parse", "--absolute-git-dir"]);
  const lock = path.join(gitDir, "devhub-implementation-preflight.lock");
  try { fs.writeFileSync(lock, runId, { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new Error("Another checkout preparation is active, or was interrupted. Check its run before retrying.");
  }

  let receipt: CheckoutPreparation | undefined;
  try {
    const available = options.assertAvailable ?? assertCheckoutAvailable;
    await available(root, runId);
    for (const entry of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer", "index.lock"]) {
      if (fs.existsSync(path.join(gitDir, entry))) throw new Error("Finish the existing Git operation before starting implementation.");
    }
    // Discover the remote's current default; a cached origin/HEAD can be stale.
    const remote = await git(root, ["ls-remote", "--symref", "origin", "HEAD"]);
    const branch = /^ref: refs\/heads\/(.+)\s+HEAD$/m.exec(remote)?.[1];
    if (!branch) throw new Error("Cannot resolve origin's default branch. Implementation has not started.");
    await git(root, ["check-ref-format", "--branch", branch]);
    const remoteRef = `refs/remotes/origin/${branch}`;
    await git(root, ["fetch", "--no-tags", "origin", `+refs/heads/${branch}:${remoteRef}`]);
    const local = await runGitRepoAsync(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    if (local.status !== 0 && local.status !== 1) throw new Error(local.stderr.trim() || "Cannot inspect the base branch.");
    if (local.status === 0) {
      const ancestor = await runGitRepoAsync(root, ["merge-base", "--is-ancestor", `refs/heads/${branch}`, remoteRef]);
      if (ancestor.status !== 0) throw new Error(`${branch} has local commits or has diverged from origin. Resolve it first; no commits were reset.`);
    }
    // Recheck after network waits, before touching the user's working tree.
    await available(root, runId);
    receipt = {
      originalBranch: await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
      originalHead: await git(root, ["rev-parse", "HEAD"]),
      branch,
      stashMessage: `DevHub before implementation ${runId}`,
    };
    options.record({ ...receipt });
    if (await git(root, ["status", "--porcelain", "--untracked-files=all"])) {
      await git(root, ["stash", "push", "--include-untracked", "--message", receipt.stashMessage]);
      receipt.stashSha = await git(root, ["rev-parse", "refs/stash"]);
      options.record({ ...receipt });
      if (await git(root, ["status", "--porcelain", "--untracked-files=all"])) {
        throw new Error("Changes remain after stashing (for example, a dirty submodule). Resolve them before starting.");
      }
    }
    // Ignored environment files stay put; Git must refuse any collision.
    await git(root, local.status === 0
      ? ["switch", "--no-overwrite-ignore", branch]
      : ["switch", "--no-overwrite-ignore", "--track", "-c", branch, `origin/${branch}`]);
    await git(root, ["merge", "--ff-only", "--no-overwrite-ignore", remoteRef]);
    receipt.baseSha = await git(root, ["rev-parse", "HEAD"]);
    if (receipt.baseSha !== await git(root, ["rev-parse", remoteRef])) throw new Error("The base branch changed during preparation. Implementation has not started.");
    options.record({ ...receipt });
    return receipt;
  } catch (error) {
    const saved = receipt?.stashSha ? ` Saved changes are in stash ${receipt.stashSha} (from ${receipt.originalBranch}); it has not been applied or dropped.` : "";
    throw new Error(`${error instanceof Error ? error.message : String(error)}${saved}`);
  } finally {
    fs.unlinkSync(lock);
  }
}

export function checkoutPreparationPrompt(receipt: CheckoutPreparation): string {
  return [
    "DevHub prepared this shared checkout before launch:",
    `- Checked out ${receipt.branch} at the fetched origin commit ${receipt.baseSha}.`,
    ...(receipt.stashSha ? [`- Previous changes from ${receipt.originalBranch} are preserved in stash ${receipt.stashSha} (${receipt.stashMessage}). Leave that stash alone; it belongs to the previous work.`] : []),
    "- Create the task branch from this base before editing. Do not repeat the stash/switch/pull preflight or overwrite the previous branch.",
  ].join("\n");
}
