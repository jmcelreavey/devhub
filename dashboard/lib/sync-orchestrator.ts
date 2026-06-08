/**
 * In-process port of scripts/update_and_sync.sh.
 *
 * Pull latest, sync skills + persona, optionally commit + push. On a dirty
 * tree git operations and collect skip; skill+persona sync still run since
 * they don't touch tracked files.
 */
import { githubCliErrorInfo } from "./gh-exec";
import { runGitRepo } from "./git-repo-local";
import { syncSkills, verifySync } from "./sync-skills";
import { syncAgents } from "./sync-agents";
import { syncPersona } from "./sync-persona";
import { syncOpencodeConfig } from "./sync-opencode-config";
import { collectSkills } from "./collect-skills";
import { collectAgents } from "./collect-agents";
import { collectOpencodeConfig } from "./collect-opencode-config";

export interface OrchestratorOptions {
  push?: boolean;
  force?: boolean;
  dryRun?: boolean;
  emit: (line: string) => void;
  repoRoot: string;
}

export interface CommitAndPushDirtyOptions {
  emit: (line: string) => void;
  repoRoot: string;
  commitMessage?: string;
}

export interface CommitAndPushPathsOptions {
  emit: (line: string) => void;
  repoRoot: string;
  paths: string[];
  commitMessage: string;
}

export interface DryRunScopedSyncOptions {
  emit: (line: string) => void;
  repoRoot: string;
  paths: string[];
  commitMessage: string;
}

export interface PushUnpushedCommitsOptions {
  emit: (line: string) => void;
  repoRoot: string;
}

function runGit(repoRoot: string, args: string[]) {
  return runGitRepo(repoRoot, args);
}

function emitGitFailure(emit: (line: string) => void, prefix: string, result: ReturnType<typeof runGitRepo>): void {
  emit(prefix);
  const mapped = githubCliErrorInfo(new Error(result.stderr || result.stdout || prefix), prefix);
  if (mapped.message !== prefix) emit(mapped.message);
  else if (result.stderr.trim()) emit(result.stderr.trim());
  else if (result.stdout.trim()) emit(result.stdout.trim());
}

/** Push current HEAD to origin/<branch>; retry with --set-upstream on failure. */
function pushOriginBranch(
  emit: (line: string) => void,
  repoRoot: string,
  branch: string,
): boolean {
  emit(`Pushing to origin/${branch}...`);
  let p = runGit(repoRoot, ["push", "origin", branch]);
  if (p.status !== 0) {
    emit("Push failed; retrying with --set-upstream...");
    p = runGit(repoRoot, ["push", "--set-upstream", "origin", branch]);
  }
  if (p.status !== 0) {
    emitGitFailure(emit, "WARNING: Push failed — check remote connection and auth.", p);
    return false;
  }
  return true;
}

function countCommitsAheadOfOrigin(repoRoot: string, branch: string): string {
  const r = runGit(repoRoot, ["rev-list", "--count", `origin/${branch}..HEAD`]);
  if (r.status !== 0) return "0";
  const n = r.stdout.trim();
  return n && n !== "" ? n : "0";
}

function listChangedFilesForPaths(repoRoot: string, paths: string[]): string[] {
  const groups = [
    runGit(repoRoot, ["diff", "--name-only", "--", ...paths]),
    runGit(repoRoot, ["diff", "--cached", "--name-only", "--", ...paths]),
    runGit(repoRoot, ["ls-files", "--others", "--exclude-standard", "--", ...paths]),
  ];
  const files = new Set<string>();
  for (const g of groups) {
    if (g.status !== 0) continue;
    for (const line of g.stdout.split("\n")) {
      const file = line.trim();
      if (file) files.add(file);
    }
  }
  return [...files].sort();
}

export async function commitAndPushDirty(opts: CommitAndPushDirtyOptions): Promise<number> {
  const { emit, repoRoot } = opts;
  const branch = runGit(repoRoot, ["branch", "--show-current"]).stdout.trim();
  if (branch !== "main" && branch !== "master") {
    emit(`ERROR: Commit & Push expects branch main/master (current: ${branch}).`);
    emit("Switch branches or commit manually in a terminal.");
    return 1;
  }

  const dirty = runGit(repoRoot, ["status", "--porcelain"]).stdout.trim().length > 0;
  if (!dirty) {
    emit("Working tree is already clean. Nothing to commit.");
    return 0;
  }

  emit("Staging all tracked + untracked changes...");
  const add = runGit(repoRoot, ["add", "-A"]);
  if (add.status !== 0) {
    emit("ERROR: git add failed.");
    if (add.stderr.trim()) emit(add.stderr.trim());
    return 1;
  }

  const commitMessage = opts.commitMessage?.trim() || `chore: devhub checkpoint ${new Date().toISOString().slice(0, 10)}`;
  emit(`Committing with message: ${commitMessage}`);
  const commit = runGit(repoRoot, ["commit", "-m", commitMessage]);
  if (commit.status !== 0) {
    emit("ERROR: git commit failed.");
    if (commit.stderr.trim()) emit(commit.stderr.trim());
    return 1;
  }

  if (!pushOriginBranch(emit, repoRoot, branch)) {
    return 1;
  }

  emit("Dirty working tree committed and pushed.");
  return 0;
}

export async function commitAndPushPaths(opts: CommitAndPushPathsOptions): Promise<number> {
  const { emit, repoRoot } = opts;
  const branch = runGit(repoRoot, ["branch", "--show-current"]).stdout.trim();
  if (branch !== "main" && branch !== "master") {
    emit(`ERROR: Commit & Push expects branch main/master (current: ${branch}).`);
    emit("Switch branches or commit manually in a terminal.");
    return 1;
  }

  const scoped = opts.paths.map((p) => p.trim()).filter(Boolean);
  if (scoped.length === 0) {
    emit("ERROR: No paths were provided for scoped commit.");
    return 1;
  }

  const changes = runGit(repoRoot, ["status", "--porcelain", "--", ...scoped]);
  if (changes.status !== 0) {
    emit("ERROR: Could not inspect scoped git status.");
    if (changes.stderr.trim()) emit(changes.stderr.trim());
    return 1;
  }
  if (!changes.stdout.trim()) {
    emit(`No changes found under: ${scoped.join(", ")}`);
    return 0;
  }

  emit(`Staging changes under: ${scoped.join(", ")}`);
  const add = runGit(repoRoot, ["add", "-A", "--", ...scoped]);
  if (add.status !== 0) {
    emit("ERROR: git add failed for scoped paths.");
    if (add.stderr.trim()) emit(add.stderr.trim());
    return 1;
  }

  const staged = runGit(repoRoot, ["diff", "--cached", "--name-only", "--", ...scoped]);
  if (staged.status !== 0) {
    emit("ERROR: Unable to inspect staged files for scoped commit.");
    if (staged.stderr.trim()) emit(staged.stderr.trim());
    return 1;
  }
  if (!staged.stdout.trim()) {
    emit(`No staged changes found under: ${scoped.join(", ")}`);
    return 0;
  }

  const commitMessage = opts.commitMessage.trim();
  emit(`Committing scoped changes with message: ${commitMessage}`);
  const commit = runGit(repoRoot, ["commit", "-m", commitMessage]);
  if (commit.status !== 0) {
    emit("ERROR: git commit failed.");
    if (commit.stderr.trim()) emit(commit.stderr.trim());
    return 1;
  }

  if (!pushOriginBranch(emit, repoRoot, branch)) {
    return 1;
  }

  emit("Scoped changes committed and pushed.");
  return 0;
}

export async function dryRunScopedSync(opts: DryRunScopedSyncOptions): Promise<number> {
  const { emit, repoRoot } = opts;
  const branch = runGit(repoRoot, ["branch", "--show-current"]).stdout.trim();
  if (branch !== "main" && branch !== "master") {
    emit(`ERROR: Dry-run scoped sync expects branch main/master (current: ${branch}).`);
    emit("Switch branches or run manually in a terminal.");
    return 1;
  }

  const scoped = opts.paths.map((p) => p.trim()).filter(Boolean);
  if (scoped.length === 0) {
    emit("ERROR: No paths were provided for dry-run scoped sync.");
    return 1;
  }

  emit(`[DRY-RUN] Scope: ${scoped.join(", ")}`);
  emit(`[DRY-RUN] Commit message: ${opts.commitMessage.trim()}`);

  const files = listChangedFilesForPaths(repoRoot, scoped);
  if (files.length === 0) {
    emit("[DRY-RUN] No changed files in scope.");
    return 0;
  }

  emit(`[DRY-RUN] ${files.length} file(s) would be committed:`);
  for (const f of files) emit(`  - ${f}`);
  emit(`[DRY-RUN] Would run: git add -A -- ${scoped.join(" ")}`);
  emit("[DRY-RUN] Would run: git commit -m <message>");
  emit(`[DRY-RUN] Would run: git push origin ${branch}`);
  return 0;
}

export async function pushUnpushedCommits(opts: PushUnpushedCommitsOptions): Promise<number> {
  const { emit, repoRoot } = opts;
  const branch = runGit(repoRoot, ["branch", "--show-current"]).stdout.trim();
  if (branch !== "main" && branch !== "master") {
    emit(`ERROR: Push unpushed commits expects branch main/master (current: ${branch}).`);
    emit("Switch branches or push manually in a terminal.");
    return 1;
  }

  const fetch = runGit(repoRoot, ["fetch", "origin", branch]);
  if (fetch.status !== 0) {
    emit("WARNING: Could not fetch remote branch; trying push anyway.");
  }

  const hasRemoteBranch =
    runGit(repoRoot, ["rev-parse", "--verify", `refs/remotes/origin/${branch}`]).status === 0;

  if (!hasRemoteBranch) {
    emit(`origin/${branch} not found. Publishing branch with upstream...`);
    return pushOriginBranch(emit, repoRoot, branch) ? 0 : 1;
  }

  const ahead = countCommitsAheadOfOrigin(repoRoot, branch);
  if (ahead === "0") {
    emit(`No unpushed commits on ${branch}.`);
    return 0;
  }

  emit(`Found ${ahead} unpushed commit(s) on ${branch}.`);
  return pushOriginBranch(emit, repoRoot, branch) ? 0 : 1;
}

export async function updateAndSync(opts: OrchestratorOptions): Promise<number> {
  const { emit, repoRoot } = opts;

  const branch = runGit(repoRoot, ["branch", "--show-current"]).stdout.trim();
  if (branch !== "main" && branch !== "master") {
    emit(`ERROR: Not on main/master branch (current: ${branch}). Switch first.`);
    return 1;
  }

  const dirty = runGit(repoRoot, ["status", "--porcelain"]).stdout.trim().length > 0;
  if (dirty) {
    emit("WARNING: Working tree is dirty — git pull / collect / commit / push will be skipped.");
    emit("WARNING: Commit or stash your changes to enable the full sync flow.");
  }

  // 1. Staleness check (only when clean)
  if (!dirty && !opts.force) {
    emit("Checking for remote changes...");
    if (runGit(repoRoot, ["fetch", "origin", branch]).status === 0) {
      const localSha = runGit(repoRoot, ["rev-parse", "HEAD"]).stdout.trim();
      const remoteSha = runGit(repoRoot, ["rev-parse", `origin/${branch}`]).stdout.trim() || localSha;
      if (localSha !== remoteSha) {
        const ahead = runGit(repoRoot, ["rev-list", "--count", `${remoteSha}..${localSha}`]).stdout.trim();
        const behind = runGit(repoRoot, ["rev-list", "--count", `${localSha}..${remoteSha}`]).stdout.trim();
        const diverged =
          ahead && ahead !== "0" && behind && behind !== "0";
        if (diverged) {
          emit(
            `ERROR: Branch diverged — ${ahead} local commit(s) not on origin and ${behind} on origin not locally. Resolve manually (rebase or merge), then sync.`,
          );
          return 1;
        }
        if (ahead && ahead !== "0") {
          emit(`Local is ${ahead} commit(s) ahead of origin — will push after sync if still ahead.`);
        }
        if (behind && behind !== "0") emit(`Remote has ${behind} new commit(s). Pulling before sync...`);
      } else {
        emit("Local is up to date with remote.");
      }
    } else {
      emit("WARNING: Could not fetch from remote — no remote configured or offline.");
    }
  }

  // 2. Pull
  if (dirty) {
    emit("Skipping pull — working tree is dirty.");
  } else if (opts.dryRun) {
    emit("[DRY-RUN] Would pull latest changes.");
  } else {
    emit("Pulling latest changes...");
    const r = runGit(repoRoot, ["pull", "--rebase", "origin", branch]);
    if (r.status !== 0) emit("WARNING: Pull failed or no remote configured. Continuing with local state.");
  }

  // 3. Sync skills (always safe — read-only on tracked files)
  emit("Syncing skills to local tools...");
  await syncSkills({ emit, repoRoot, dryRun: opts.dryRun, prune: false });
  emit("Syncing agents to local tools...");
  await syncAgents({ emit, repoRoot, dryRun: opts.dryRun, prune: false });

  // 4. Verify skill writes landed correctly
  if (!opts.dryRun) {
    emit("Verifying skill sync health...");
    await verifySync({ emit, repoRoot });
  }

  // 5. Sync persona
  emit("Syncing persona to tool configs...");
  await syncPersona({ emit, repoRoot, dryRun: opts.dryRun });

  // 6. Sync OpenCode model/provider config (preserves mcp + other keys)
  emit("Syncing OpenCode config...");
  await syncOpencodeConfig({ emit, repoRoot, dryRun: opts.dryRun });

  // 7. Collect (only when clean — touches the index)
  if (dirty) {
    emit("Skipping local skill collection — working tree is dirty.");
  } else {
    emit("Checking for new local skills and agents...");
    await collectSkills({ emit, repoRoot, dryRun: opts.dryRun });
    await collectAgents({ emit, repoRoot, dryRun: opts.dryRun });
    emit("Checking for local OpenCode config changes...");
    await collectOpencodeConfig({ emit, repoRoot, dryRun: opts.dryRun });
  }

  // Summary + optional push
  emit("=== Sync Summary ===");
  const staged = runGit(repoRoot, ["diff", "--cached", "--name-only"]).stdout.trim();
  if (opts.dryRun) {
    emit(staged ? "[DRY-RUN] Would commit and potentially push staged changes." : "[DRY-RUN] No changes to commit.");
  } else if (staged && opts.push) {
    emit("Committing and pushing staged changes...");
    runGit(repoRoot, ["commit", "-m", `sync: automated update ${new Date().toISOString().slice(0, 10)}`]);
    pushOriginBranch(emit, repoRoot, branch);
  } else if (staged) {
    emit("Changes are staged but not committed.");
    emit("Review with: git status");
  } else {
    emit("No staged changes from collect in this run.");
  }

  // 8. Push any commits still not on origin (unpushed work from before this run, or if the push above failed)
  if (!opts.dryRun && !dirty && opts.push) {
    if (runGit(repoRoot, ["fetch", "origin", branch]).status === 0) {
      const hasRemoteBranch =
        runGit(repoRoot, ["rev-parse", "--verify", `refs/remotes/origin/${branch}`]).status === 0;
      if (hasRemoteBranch) {
        const aheadAfter = countCommitsAheadOfOrigin(repoRoot, branch);
        if (aheadAfter !== "0") {
          emit(`Local is still ${aheadAfter} commit(s) ahead of origin/${branch} — pushing...`);
          pushOriginBranch(emit, repoRoot, branch);
        }
      } else {
        emit(`origin/${branch} not found on remote — attempting push to publish...`);
        pushOriginBranch(emit, repoRoot, branch);
      }
    }
  }

  emit("Done.");
  return 0;
}
