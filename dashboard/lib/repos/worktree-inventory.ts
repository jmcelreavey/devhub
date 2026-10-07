import fs from "node:fs";
import path from "node:path";
import { listAgentRuns, type AgentRun } from "@/lib/agent-runs/store";
import { isActiveAgentRunState } from "@/lib/agent-runs/run-files";
import { listRegisteredTerminalSessions } from "@/lib/terminal-sessions-registry";
import { execExternal } from "@/lib/exec-external";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { getNoteIndex, type NoteSummary } from "@/lib/notes/note-index";
import { listTaskDays } from "@/lib/tasks/storage";
import { listTaskAgentRuns } from "@/lib/tasks/task-agent-runs";
import type { TaskAgentRunRecord } from "@/lib/tasks/task-agent-runs";
import { taskNotePath } from "@/lib/task-note";
import type { Task } from "@/lib/tasks/types";
import { parseWorktreeList, type Worktree } from "./worktree-parsers";
import { worktreeTitle, type WorktreeInfo, type WorktreeInventory, type WorktreeRun } from "./worktree-info";
import { loadMergedWorktreePrs, verifyWorktreeMerge, type MergedWorktreePrs } from "./worktree-merge";

interface TaskContext { task: Task; date: string; runs: TaskAgentRunRecord[] }
export interface WorktreeContext { tasks: TaskContext[]; runs: AgentRun[]; notes: NoteSummary[] }

function inside(cwd: string | undefined, root: string): boolean {
  if (!cwd) return false;
  const relative = path.relative(root, cwd);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative) && !relative.split(path.sep).includes(".git"));
}

export function loadWorktreeContext(): WorktreeContext {
  const tasks = new Map<string, TaskContext>();
  for (const day of listTaskDays()) {
    for (const task of day.tasks) {
      if (!tasks.has(task.id)) tasks.set(task.id, { task, date: day.date, runs: listTaskAgentRuns(task.id) });
    }
  }
  return { tasks: [...tasks.values()], runs: listAgentRuns(Number.MAX_SAFE_INTEGER), notes: getNoteIndex().notes };
}

export function describeWorktree(tree: Worktree, context: WorktreeContext): WorktreeInfo {
  const runs = context.runs.filter((run) => inside(run.spec.worktree?.path ?? run.spec.cwd, tree.path))
    // A worktree nested below .git must not also match the main checkout.
    .filter((run) => !tree.isMain || !run.spec.worktree || run.spec.worktree.path === tree.path);
  const linked = context.tasks.filter(({ task, runs: records }) =>
    runs.some((run) => run.spec.activity?.taskId === task.id) ||
    records.some((record) => inside(record.cwd, tree.path) &&
      (!tree.isMain || !record.cwd?.includes(`${path.sep}.git${path.sep}`))),
  );
  const records = linked.flatMap((item) => item.runs).filter((run) => inside(run.cwd, tree.path))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const notePaths = new Set([
    ...linked.flatMap(({ task, date }) => [
      taskNotePath({ ...task, date }),
      ...(task.links ?? []).filter((link) => link.kind === "note").map((link) => link.id),
    ]),
    ...runs.map((run) => run.spec.activity?.notePath).filter((p): p is string => Boolean(p)),
  ]);
  const tasks = linked.map(({ task, date }) => ({
    id: task.id, title: task.text.replace(/#[\w/-]+/g, "").trim(), date, jiraKey: task.jiraKey,
    finished: Boolean(task.done || task.abandonedAt),
  }));
  const pr = records.find((record) => record.prUrl);
  return {
    ...tree,
    title: tree.isMain ? "Main checkout" : tasks[0]?.title || runs[0]?.spec.title || worktreeTitle(tree),
    tasks,
    notes: context.notes.filter((note) => notePaths.has(note.slug))
      .map(({ title, href }) => ({ title, href })),
    runs: runs.map<WorktreeRun>((run) => ({
      id: run.spec.id, title: run.spec.title, status: run.status.state,
      active: isActiveAgentRunState(run.status.state), updatedAt: run.status.updatedAt,
    })).concat(records.filter((record) => !runs.some((run) => run.spec.id === record.runId)).map((record) => ({
      id: record.runId, title: tasks[0]?.title || "Task run", status: record.status,
      active: ["queued", "running", "paused"].includes(record.status),
      updatedAt: Date.parse(record.updatedAt),
    }))).sort((a, b) => b.updatedAt - a.updatedAt),
    ...(pr?.prUrl ? { pr: { url: pr.prUrl, state: pr.prState, checkedAt: pr.prCheckedAt } } : {}),
  };
}

export function cleanupAssessment(tree: WorktreeInfo, dirty: number | null, unpushed: number | null, lastActivity: number | null) {
  const blockers: string[] = [];
  if (tree.isMain) blockers.push("Main checkout");
  if (tree.locked) blockers.push("Locked");
  if (tree.merge?.openPr) blockers.push(`PR #${tree.merge.openPr.number} is still open`);
  if (listRegisteredTerminalSessions().some((session) => session.status !== "closed" && inside(session.cwd, tree.path))) blockers.push("Open DevHub terminal in this checkout");
  if (tree.prunable || !fs.existsSync(tree.path)) blockers.push("Folder missing — use Prune stale");
  if (tree.runs.some((run) => run.active)) blockers.push("Agent run still active or awaiting input");
  if (dirty === null) blockers.push("Could not check local changes");
  else if (dirty > 0) blockers.push(`${dirty} changed or untracked files`);
  if (unpushed === null && !tree.merge?.verified) blockers.push("Could not check remote commits");
  else if (unpushed !== null && unpushed > 0 && !tree.merge?.verified) blockers.push(`${unpushed} commits not on a remote ref`);
  const finished = tree.tasks.length > 0 && tree.tasks.every((task) => task.finished);
  const old = lastActivity !== null && Date.now() - lastActivity > 14 * 86_400_000;
  const reason = tree.merge?.verified ? tree.merge.reason
    : finished ? "Associated tasks finished" : old ? "No recorded activity for 14 days" : "Recent or unfinished work";
  return { blockers, candidate: blockers.length === 0 && (tree.merge?.verified === true || finished || old), reason };
}

export async function inspectWorktree(tree: WorktreeInfo, merges?: MergedWorktreePrs): Promise<WorktreeInfo> {
  if (merges && !tree.isMain && !tree.prunable) tree = { ...tree, merge: await verifyWorktreeMerge(tree, merges) };
  let dirtyCount: number | null = null, unpushedCount: number | null = null, sizeBytes: number | null = null;
  let ignoredPaths: string[] = [], lastActivity: number | null = null;
  if (!tree.prunable && fs.existsSync(tree.path)) {
    const [status, unpushed, ignored, log, size] = await Promise.all([
      runGitRepoAsync(tree.path, ["status", "--porcelain", "--untracked-files=all"], { timeout: 15_000 }),
      runGitRepoAsync(tree.path, ["rev-list", "--count", "HEAD", "--not", "--remotes"], { timeout: 15_000 }),
      runGitRepoAsync(tree.path, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"], { timeout: 15_000 }),
      runGitRepoAsync(tree.path, ["log", "-1", "--format=%ct"], { timeout: 5_000 }),
      // du does not follow symlinks; a timeout is reported as unavailable, never zero.
      tree.isMain ? Promise.resolve(null) : execExternal("du", ["-sk", tree.path], { timeoutMs: 15_000 }).catch(() => null),
    ]);
    if (status.status === 0) dirtyCount = status.stdout.trim() ? status.stdout.trim().split("\n").length : 0;
    if (unpushed.status === 0 && /^\d+$/.test(unpushed.stdout.trim())) unpushedCount = Number(unpushed.stdout.trim());
    if (ignored.status === 0) ignoredPaths = ignored.stdout.split("\0").filter(Boolean);
    if (size && /^\d+/.test(size.stdout)) sizeBytes = Number(size.stdout.match(/^\d+/)?.[0]) * 1024;
    lastActivity = Math.max(
      log.status === 0 ? Number(log.stdout.trim()) * 1000 || 0 : 0,
      fs.statSync(tree.path, { throwIfNoEntry: false })?.mtimeMs ?? 0,
      ...tree.runs.map((run) => run.updatedAt || 0),
    ) || null;
    if (ignored.status !== 0) dirtyCount = null; // Cannot promise the deletion preview is complete.
  }
  return { ...tree, details: { dirtyCount, unpushedCount, sizeBytes, ignoredPaths, lastActivity,
    ...cleanupAssessment(tree, dirtyCount, unpushedCount, lastActivity) } };
}

export async function worktreeInventory(repoRoot: string, details = false, taskId?: string, context = loadWorktreeContext()): Promise<WorktreeInventory> {
  const result = await runGitRepoAsync(repoRoot, ["worktree", "list", "--porcelain"]);
  if (result.status !== 0) throw new Error(result.stderr || "Could not list worktrees");
  const trees = parseWorktreeList(result.stdout);
  const merges = details ? await loadMergedWorktreePrs(repoRoot, trees.filter((tree) => !tree.isMain && !tree.prunable).flatMap((tree) => tree.branch ? [tree.branch] : [])) : undefined;
  const worktrees: WorktreeInfo[] = [];
  // Bound disk scans: repositories can have many large node_modules directories.
  for (let start = 0; start < trees.length; start += 4) {
    worktrees.push(...await Promise.all(trees.slice(start, start + 4).map(async (tree) => {
      const described = describeWorktree(tree, context);
      return details ? inspectWorktree(described, merges) : described;
    })));
  }
  const candidates = taskId ? [
    ...(context.tasks.find(({ task }) => task.id === taskId)?.runs ?? []).filter((run) => run.cwd)
      .map((run) => ({ cwd: context.runs.find((agent) => agent.spec.id === run.runId)?.spec.worktree?.path || run.cwd!, updatedAt: Date.parse(run.updatedAt) })),
    ...context.runs.filter((run) => run.spec.activity?.taskId === taskId)
      .map((run) => ({ cwd: run.spec.worktree?.path || run.spec.cwd, updatedAt: run.status.updatedAt })),
  ].sort((a, b) => b.updatedAt - a.updatedAt) : [];
  const cwd = candidates[0]?.cwd;
  // A removed checkout under .git must never silently resolve to the main checkout.
  const preferredPath = cwd ? [...trees].sort((a,b) => b.path.length-a.path.length).find((tree) => inside(cwd, tree.path))?.path ?? cwd : null;
  return { worktrees, repoRoot, mergedCleanupSupported: true, ...(taskId ? { preferredPath } : {}) };
}
