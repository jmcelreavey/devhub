import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { todayISO } from "../../../../../packages/shared/tasks/dates.ts";
import { normalizeTaskLinkState } from "../../../../../packages/shared/task-note/index.ts";
import { type Task, type TaskDay, type TaskDaySummary } from "../../../../../packages/shared/tasks/types.ts";
import type { EntityRef } from "../../../../../packages/shared/entity-note/index.ts";
import { migrateTasksRoot, migrationNoticeFor } from "./migrate.ts";
import { listDays, tasksOnDay } from "./store.ts";
import { taskStorage } from "../storage/tasks.ts";

interface TaskServiceDependencies {
  getActiveTasksDir(): string;
  getNotesDir(): string;
  getTasksDir(): string;
  createTaskNoteResolver(): (task: Task, date: string) => { notePath: string };
  listRepoNames(): string[];
  resolveTaskInput(text: string, links?: EntityRef[], repoNames?: readonly string[]): { text: string; links: EntityRef[] };
  seedSummaryFromJira(task: Task, date: string): Promise<void>;
}

export function createTaskService({ getActiveTasksDir, getNotesDir, getTasksDir, createTaskNoteResolver, listRepoNames, resolveTaskInput, seedSummaryFromJira }: TaskServiceDependencies) {
  function tasksDir(): string {
    return getActiveTasksDir();
  }

  function runsDir(): string {
    return path.join(getNotesDir(), ".config", "task-agent-runs");
  }

  function insideTmp(dir: string): boolean {
    // The dir may not exist yet; resolve symlinks (macOS /var → /private/var) on the nearest ancestor that does.
    const real = (p: string): string => {
      const abs = path.resolve(p);
      try {
        return fs.realpathSync(abs);
      } catch {
        const parent = path.dirname(abs);
        return parent === abs ? abs : path.join(real(parent), path.basename(abs));
      }
    };
    const rel = path.relative(real(os.tmpdir()), real(dir));
    return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
  }

  /**
   * The migration writes into the content dir, so it must not run where nobody
   * asked for it: `next build` imports route modules, and tests that never set a
   * content root would resolve to the checkout's own tasks/.
   */
  function migrationAllowed(dir = getTasksDir()): boolean {
    if (process.env.NEXT_PHASE === "phase-production-build") return false;
    if (process.env.NODE_ENV === "test" || process.env.VITEST) {
      const configured = process.env.TASKS_DIR?.trim();
      return !!configured && path.resolve(configured) === path.resolve(dir) && insideTmp(dir);
    }
    return true;
  }

  /** Import legacy day files. Concurrent callers share the in-flight run; a later call sees new files. */
  function ensureTasksMigrated(): Promise<void> {
    const dir = getTasksDir();
    if (!migrationAllowed(dir)) return Promise.resolve();
    return migrateTasksRoot(dir, { runsDir: runsDir() }).then(() => undefined);
  }

  function taskMigrationNotice(): string {
    const active = migrationNoticeFor(tasksDir());
    return active || migrationNoticeFor(getTasksDir());
  }

  function present(task: Task, date: string): Task {
    const notePath = createTaskNoteResolver()(task, date).notePath;
    if (task.jiraKey || !task.links?.some((link) => link.kind === "jira")) return { ...task, notePath };
    const normalized = normalizeTaskLinkState(task.text, task.jiraKey, task.links, task.parentKey);
    return { ...task, notePath, text: normalized.text, jiraKey: normalized.jiraKey, links: normalized.links };
  }

  async function canonicalId(id: string): Promise<string | null> {
    const hit = await taskStorage(tasksDir()).find(id);
    return hit?.id ?? null;
  }

  function getTasks(date?: string): Task[] {
    const target = date ?? todayISO();
    return tasksOnDay(tasksDir(), target, todayISO()).map((task) => present(task, target));
  }

  async function addTask(
    text: string,
    date?: string,
    due?: string,
    links?: Task["links"],
    stage?: Task["stage"],
    parentKey?: string,
  ): Promise<Task> {
    await ensureTasksMigrated();
    const startDate = date ?? todayISO();
    const input = resolveTaskInput(text, links, text.includes("@") ? listRepoNames() : []);
    const task = await taskStorage(tasksDir()).create({ ...input, startDate, due, stage, parentKey });
    // A ticket-backed task gets the ticket's description as its summary; the response doesn't wait for Jira.
    if (task.jiraKey) void seedSummaryFromJira(task, startDate);
    return present(task, startDate);
  }

  async function toggleTask(taskId: string, date?: string): Promise<Task | null> {
    await ensureTasksMigrated();
    const target = date ?? todayISO();
    const id = await canonicalId(taskId);
    if (!id) return null;
    const task = await taskStorage(tasksDir()).withWriteLock(async (storage) => {
      const current = await storage.find(id);
      return current ? storage.patch(id, { status: current.done ? "reactivate" : "complete" }) : null;
    });
    return task ? present(task, target) : null;
  }

  async function setTaskCompletion(taskId: string, completed: boolean, date?: string): Promise<Task | null> {
    await ensureTasksMigrated();
    const id = await canonicalId(taskId);
    if (!id) return null;
    const task = await taskStorage(tasksDir()).withWriteLock(async (storage) => {
      const current = await storage.find(id);
      if (!current || current.done === completed) return current;
      return storage.patch(id, { status: completed ? "complete" : "reactivate" });
    });
    return task ? present(task, date ?? todayISO()) : null;
  }

  async function abandonTask(taskId: string, reason?: string, date?: string): Promise<Task | null> {
    await ensureTasksMigrated();
    const target = date ?? todayISO();
    const id = await canonicalId(taskId);
    if (!id) return null;
    const task = await taskStorage(tasksDir()).patch(id, { status: "abandon", abandonReason: reason });
    return task ? present(task, target) : null;
  }

  async function reactivateTask(taskId: string, date?: string): Promise<Task | null> {
    await ensureTasksMigrated();
    const target = date ?? todayISO();
    const id = await canonicalId(taskId);
    if (!id) return null;
    const task = await taskStorage(tasksDir()).patch(id, { status: "reactivate" });
    return task ? present(task, target) : null;
  }

  async function deleteTask(taskId: string): Promise<boolean> {
    await ensureTasksMigrated();
    const id = await canonicalId(taskId);
    if (!id) return false;
    return taskStorage(tasksDir()).delete(id);
  }

  async function updateTask(
    taskId: string,
    patch: { text?: string; due?: string | null; links?: Task["links"]; stage?: "draft" | "ready" },
    date?: string,
  ): Promise<Task | null> {
    await ensureTasksMigrated();
    const target = date ?? todayISO();
    const id = await canonicalId(taskId);
    if (!id) return null;
    const task = await taskStorage(tasksDir()).withWriteLock(async (storage) => {
      const existing = await storage.find(id);
      if (!existing) return null;
      return storage.patch(id, taskUpdatePatch(existing, patch));
    });
    return task ? present(task, target) : null;
  }

  function taskUpdatePatch(
    existing: Task,
    patch: { text?: string; due?: string | null; links?: Task["links"]; stage?: "draft" | "ready" },
  ) {
    const next = { ...patch };
    if (patch.text !== undefined) {
      const repoNames = patch.text.includes("@") ? listRepoNames() : [];
      Object.assign(next, resolveTaskInput(patch.text, patch.links ?? existing.links, repoNames));
    } else if (patch.links !== undefined) {
      const normalized = normalizeTaskLinkState(existing.text, existing.jiraKey, patch.links, existing.parentKey);
      next.text = normalized.text;
      next.links = normalized.links?.length ? normalized.links : [];
    }
    return next;
  }

  async function reorderOpenTasks(taskIds: string[], date?: string): Promise<Task[]> {
    await ensureTasksMigrated();
    const target = date ?? todayISO();
    const tasks = await taskStorage(tasksDir()).reorder(taskIds, target, todayISO());
    return tasks.map((task) => present(task, target));
  }

  async function startTaskTimer(taskId: string, date?: string): Promise<Task | null> {
    await ensureTasksMigrated();
    const target = date ?? todayISO();
    const id = await canonicalId(taskId);
    if (!id) return null;
    const task = await taskStorage(tasksDir()).startTimer(id);
    return task ? present(task, target) : null;
  }

  async function stopTaskTimer(taskId: string, date?: string): Promise<Task | null> {
    await ensureTasksMigrated();
    const target = date ?? todayISO();
    const id = await canonicalId(taskId);
    if (!id) return null;
    const task = await taskStorage(tasksDir()).stopTimer(id);
    return task ? present(task, target) : null;
  }

  function summarize(date: string, tasks: Task[]): TaskDaySummary {
    return {
      date,
      total: tasks.length,
      completed: tasks.filter((task) => task.done).length,
      abandoned: tasks.filter((task) => !!task.abandonedAt).length,
      moved: tasks.filter((task) => task.endReason === "legacy-moved" && task.endDate === date).length,
      modified: itemsModified(tasksDir()),
    };
  }

  function itemsModified(dir: string): number {
    try {
      return fs.statSync(path.join(dir, "items")).mtimeMs;
    } catch {
      return 0;
    }
  }

  function listTaskFiles(): TaskDaySummary[] {
    return listDays(tasksDir(), todayISO()).map(({ date, tasks }) => summarize(date, tasks));
  }

  function listTaskDays(): TaskDay[] {
    return listDays(tasksDir(), todayISO()).map(({ date, tasks }) => ({
      ...summarize(date, tasks),
      tasks: tasks.map((task) => present(task, date)),
    }));
  }

  return { migrationAllowed, ensureTasksMigrated, taskMigrationNotice, present, getTasks, addTask, toggleTask, setTaskCompletion, abandonTask, reactivateTask, deleteTask, updateTask, taskUpdatePatch, reorderOpenTasks, startTaskTimer, stopTaskTimer, itemsModified, listTaskFiles, listTaskDays };
}
