import fs from "node:fs";
import path from "node:path";
import { getCheckoutRoot } from "@/lib/content/dirs";
import { execExternal } from "@/lib/exec-external";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { loadPaseoWorktreeActivity } from "@/lib/paseo/workspaces";
import { listRegisteredTerminalSessions } from "@/lib/terminal-sessions-registry";
import { loadWorktreeContext, worktreeInventory, type WorktreeContext } from "./worktree-inventory";
import type { WorktreeInfo } from "./worktree-info";

const DAY_MS = 86_400_000;
const GENERATED_FILES = new Set([
  "dashboard/lib/plugin-branding.generated.ts",
  "dashboard/app/plugin-branding.generated.css",
]);

export interface WorktreeMaintenanceResult {
  dryRun: boolean;
  removed: string[];
  trimmed: string[];
  freedBytes: number;
  plannedBytes: number;
  errors: string[];
}

class KeepWorktreeError extends Error {}

interface Activity {
  context: WorktreeContext;
  paths: string[];
  paseo: Awaited<ReturnType<typeof loadPaseoWorktreeActivity>>;
}
interface DiskUsage { bytes: number; modifiedAt: number; builds: string[] }
interface Assessment {
  tree: WorktreeInfo;
  disk: DiskUsage;
  removable: boolean;
  generated: string[];
  tracked: string[];
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function canonical(candidate: string): string {
  try { return fs.realpathSync(candidate); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return path.resolve(candidate);
    throw error;
  }
}

export function parseProcessCwds(output: string): string[] {
  const paths = output.split("\n").filter((line) => line.startsWith("n")).map((line) => line.slice(1));
  const processes = output.split("\n").filter((line) => /^p\d+$/.test(line));
  if (processes.length === 0 || processes.length !== paths.length || paths.some((cwd) => !path.isAbsolute(cwd))) {
    throw new Error("Could not verify running process working directories");
  }
  return paths;
}

async function loadActivity(): Promise<Activity> {
  const processCwds = await execExternal("lsof", ["-nP", "-d", "cwd", "-F", "pn"], {
    timeoutMs: 15_000, maxBuffer: 8 * 1024 * 1024, label: "worktree-cleanup:process-cwds",
  });
  if (processCwds.stderr.trim()) throw new Error("Process cwd inspection was incomplete; nothing deleted");
  return {
    context: loadWorktreeContext(),
    paths: [...parseProcessCwds(processCwds.stdout), process.cwd(),
      ...listRegisteredTerminalSessions().flatMap((session) => session.status !== "closed" && session.cwd ? [session.cwd] : [])],
    paseo: await loadPaseoWorktreeActivity(),
  };
}

function activityBlocker(tree: WorktreeInfo, activity: Activity): string | null {
  if (tree.tasks.some((task) => !task.finished)) return "Linked task is still active";
  if (tree.runs.some((run) => run.active)) return "Linked agent run is still active";
  for (const item of activity.context.tasks) {
    if (!item.runs.some((run) => tree.branch && run.branch === tree.branch)) continue;
    if (!item.task.done && !item.task.abandonedAt) return "Linked task is still active";
    if (item.runs.some((run) => run.branch === tree.branch && ["queued", "running", "paused"].includes(run.status))) return "Linked task run is still active";
  }
  if (activity.paths.some((cwd) => inside(tree.path, canonical(cwd)))) return "Process or terminal cwd is in this checkout";
  if (activity.paseo.some((session) => session.active && inside(tree.path, canonical(session.path)))) return "Paseo workspace is still active";
  return null;
}

async function git(root: string, args: string[]): Promise<string> {
  const result = await runGitRepoAsync(root, ["--no-optional-locks", "-c", "core.fsmonitor=false", ...args], { timeout: 30_000 });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `Git check failed: ${args[0]}`);
  return result.stdout;
}

function scoped(tree: WorktreeInfo, checkouts: string, trees: WorktreeInfo[]): boolean {
  return !tree.isMain && !tree.locked && !tree.prunable && tree.path !== checkouts && inside(checkouts, tree.path) &&
    canonical(tree.path) === tree.path && fs.lstatSync(tree.path).isDirectory() &&
    !trees.some((other) => other.path !== tree.path && inside(tree.path, other.path));
}

async function scanDisk(root: string, cutoff?: number, worktreeRoot = false, signal?: AbortSignal): Promise<DiskUsage> {
  const usage: DiskUsage = { bytes: 0, modifiedAt: 0, builds: [] };
  async function visit(file: string, inBuild: boolean): Promise<void> {
    signal?.throwIfAborted();
    const stat = await fs.promises.lstat(file);
    usage.modifiedAt = Math.max(usage.modifiedAt, stat.mtimeMs);
    usage.bytes += stat.nlink > 1 && stat.isFile() ? 0 : stat.blocks * 512;
    if (cutoff !== undefined && usage.modifiedAt > cutoff) return;
    if (!stat.isDirectory()) return;
    if ((file !== root || !worktreeRoot) && fs.existsSync(path.join(file, ".git"))) throw new KeepWorktreeError("Nested repository — kept");
    const name = path.basename(file);
    const build = file !== root && (name === "node_modules" || name === ".next" ||
      (name === "target" && fs.existsSync(path.join(path.dirname(file), "Cargo.toml"))));
    if (build && !inBuild) usage.builds.push(file);
    const directory = await fs.promises.opendir(file);
    for await (const entry of directory) {
      await visit(path.join(file, entry.name), inBuild || build);
      if (cutoff !== undefined && usage.modifiedAt > cutoff) break;
    }
  }
  await visit(root, false);
  return usage;
}

async function assess(repoRoot: string, checkouts: string, target: string, now: number, signal: AbortSignal): Promise<Assessment | null> {
  const activity = await loadActivity();
  const inventory = await worktreeInventory(repoRoot, false, undefined, activity.context);
  const tree = inventory.worktrees.find((candidate) => candidate.path === target);
  if (!tree || !scoped(tree, checkouts, inventory.worktrees)) return null;
  const blocker = activityBlocker(tree, activity);
  if (blocker) throw new KeepWorktreeError(blocker);
  const disk = await scanDisk(tree.path, now - 2 * DAY_MS, true, signal);
  const gitDir = (await git(tree.path, ["rev-parse", "--absolute-git-dir"])).trim();
  for (const marker of ["index.lock", "HEAD.lock", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "BISECT_LOG"]) {
    if (fs.existsSync(path.join(gitDir, marker))) throw new KeepWorktreeError("Git operation is in progress; kept");
  }
  for (const file of ["HEAD", "index", "logs/HEAD"]) {
    disk.modifiedAt = Math.max(disk.modifiedAt, fs.statSync(path.join(gitDir, file), { throwIfNoEntry: false })?.mtimeMs ?? 0);
  }
  disk.modifiedAt = Math.max(disk.modifiedAt, ...tree.runs.map((run) => run.updatedAt),
    ...activity.paseo.filter((session) => inside(tree.path, canonical(session.path))).map((session) => session.updatedAt));
  if (disk.modifiedAt > now - 2 * DAY_MS) return null;
  const changes = (await git(tree.path, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).split("\0").filter(Boolean);
  const generated = changes.filter((entry) => [" M", "??"].includes(entry.slice(0, 2)) && GENERATED_FILES.has(entry.slice(3)));
  const clean = changes.every((entry) => generated.includes(entry));
  const ignored = (await git(tree.path, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
  const ahead = (await git(tree.path, ["rev-list", "--count", "refs/remotes/origin/main..HEAD"])).trim();
  if (!/^\d+$/.test(ahead)) throw new Error("Could not verify commits beyond origin/main");
  const indexed = (await git(tree.path, ["ls-files", "-v", "-z"])).split("\0").filter(Boolean);
  const hiddenChanges = indexed.some((entry) => (entry[0] === "S" || entry[0] === entry[0].toLowerCase()) && !GENERATED_FILES.has(entry.slice(2)));
  const tracked = indexed.map((entry) => entry.slice(2));
  const disposable = (file: string) => GENERATED_FILES.has(file) || disk.builds.some((build) => inside(build, path.join(tree.path, file)));
  return { tree, disk, tracked, generated, removable: Boolean(tree.branch && ahead === "0" && clean && !hiddenChanges && ignored.every(disposable)) };
}

async function requireInactiveWorktree(repoRoot: string, checkouts: string, expected: WorktreeInfo): Promise<void> {
  const activity = await loadActivity();
  const inventory = await worktreeInventory(repoRoot, false, undefined, activity.context);
  const current = inventory.worktrees.find((candidate) => candidate.path === expected.path);
  if (!current || !scoped(current, checkouts, inventory.worktrees) || current.head !== expected.head ||
    current.branch !== expected.branch || activityBlocker(current, activity)) throw new KeepWorktreeError("Activity or checkout changed; kept");
}

function space(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB (${bytes} bytes, allocated-space estimate)`;
}

export async function cleanupWorktrees(emit: (line: string) => void, options: { dryRun?: boolean } = {}): Promise<WorktreeMaintenanceResult> {
  const result: WorktreeMaintenanceResult = { dryRun: options.dryRun === true, removed: [], trimmed: [], freedBytes: 0, plannedBytes: 0, errors: [] };
  const now = Date.now();
  const signal = AbortSignal.timeout(12 * 60_000);
  try {
    const checkout = getCheckoutRoot();
    if (!checkout) throw new Error("No linked checkout; nothing deleted");
    const repoRoot = canonical(checkout);
    const checkouts = path.join(repoRoot, ".devhub", "checkouts");
    if (!fs.existsSync(checkouts)) { emit("No .devhub/checkouts directory; nothing deleted."); return result; }
    if (canonical(checkouts) !== checkouts) throw new Error("Checkout directory is a symlink; nothing deleted");
    const inventory = await worktreeInventory(repoRoot, false, undefined, loadWorktreeContext());
    emit(`${result.dryRun ? "DRY RUN: " : ""}Cleanup scope: ${checkouts}; branches are always kept.`);
    for (const tree of inventory.worktrees) {
      if (!inside(checkouts, tree.path) || tree.isMain) continue;
      try {
        signal.throwIfAborted();
        let assessment = await assess(repoRoot, checkouts, tree.path, now, signal);
        if (!assessment) { emit(`Kept ${tree.path}: locked, recent, missing or outside the safe scope.`); continue; }
        if (assessment.removable) {
          result.plannedBytes += assessment.disk.bytes;
          if (result.dryRun) { emit(`Would remove ${tree.path}; would free ${space(assessment.disk.bytes)}.`); continue; }
          assessment = await assess(repoRoot, checkouts, tree.path, now, signal);
          if (!assessment?.removable) { emit(`Kept ${tree.path}: safety evidence changed.`); continue; }
          await requireInactiveWorktree(repoRoot, checkouts, assessment.tree);
          if ((await git(tree.path, ["rev-list", "--count", "refs/remotes/origin/main..HEAD"])).trim() !== "0") throw new KeepWorktreeError("Branch gained commits; kept");
          signal.throwIfAborted();
          for (const entry of assessment.generated) {
            const file = entry.slice(3);
            if (entry.startsWith("??")) await fs.promises.unlink(path.join(tree.path, file));
            else await git(tree.path, ["restore", "--worktree", "--", file]);
          }
          await git(repoRoot, ["worktree", "remove", "--", tree.path]);
          result.removed.push(tree.path);
          result.freedBytes += assessment.disk.bytes;
          emit(`Removed ${tree.path}; branch ${tree.branch} kept; freed ${space(assessment.disk.bytes)}.`);
          await git(repoRoot, ["worktree", "prune"]);
          continue;
        }
        if (assessment.disk.modifiedAt > now - 7 * DAY_MS) { emit(`Kept ${tree.path}: not eligible for removal or 7-day build cleanup.`); continue; }
        for (const build of assessment.disk.builds) {
          const relative = path.relative(tree.path, build).split(path.sep).join("/");
          if (assessment.tracked.some((file) => file === relative || file.startsWith(`${relative}/`))) continue;
          const ignored = await runGitRepoAsync(tree.path, ["check-ignore", "-q", "--", `${relative}/`]);
          if (ignored.status !== 0) continue;
          const usage = await scanDisk(build, undefined, false, signal);
          result.plannedBytes += usage.bytes;
          if (result.dryRun) { emit(`Would delete build directory ${build}; would free ${space(usage.bytes)}.`); continue; }
          if (canonical(build) !== build || !fs.lstatSync(build).isDirectory()) throw new Error("Build directory changed; kept");
          const fresh = await scanDisk(build, undefined, false, signal);
          if (fresh.modifiedAt > now - 7 * DAY_MS) throw new Error("Build directory was recently modified; kept");
          const tracked = (await git(tree.path, ["ls-files", "-z", "--", `:(literal)${relative}`])).trim();
          if (tracked) throw new Error("Build directory contains tracked files; kept");
          await requireInactiveWorktree(repoRoot, checkouts, assessment.tree);
          signal.throwIfAborted();
          await fs.promises.rm(build, { recursive: true });
          result.trimmed.push(build);
          result.freedBytes += fresh.bytes;
          emit(`Deleted build directory ${build}; source and branch kept; freed ${space(fresh.bytes)}.`);
        }
      } catch (error) {
        const message = `${tree.path}: ${error instanceof Error ? error.message : "Safety check failed"}`;
        if (!(error instanceof KeepWorktreeError)) result.errors.push(message);
        emit(`Kept / stopped: ${message}`);
        if (signal.aborted) break;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cleanup failed";
    result.errors.push(message);
    emit(message);
  }
  emit(`${result.dryRun ? "DRY RUN: would free" : "Freed"} ${space(result.dryRun ? result.plannedBytes : result.freedBytes)}; removed ${result.removed.length} worktree(s), trimmed ${result.trimmed.length} build directory(s).`);
  return result;
}
