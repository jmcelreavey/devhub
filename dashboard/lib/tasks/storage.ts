import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getActiveTasksDir, getNotesDir, getTasksDir } from "@/lib/notes/dir";
import { todayISO } from "@/lib/utils";
import { normalizeTaskLinkState } from "@/lib/task-note";
import { migrateTasksRoot, migrationNoticeFor } from "@shared/tasks/migrate.ts";
import {
  createTask,
  deleteTask as removeTask,
  findTask,
  listDays,
  patchTask,
  readItems,
  reorderOpenTasks as reorderItems,
  startTimer,
  stopTimer,
  tasksOnDay,
  withTaskLock,
} from "@shared/tasks/store.ts";
import { taskMatchesId } from "@shared/tasks/view.ts";
import { createTaskNoteResolver } from "./task-notes";
import type { Task } from "@/lib/tasks/types";

export type { Task } from "@/lib/tasks/types";
export { isTaskOpen } from "@/lib/tasks/types";

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
export function migrationAllowed(dir = getTasksDir()): boolean {
  if (process.env.NEXT_PHASE === "phase-production-build") return false;
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return insideTmp(dir);
  return true;
}

/** Import legacy day files. Concurrent callers share the in-flight run; a later call sees new files. */
export function ensureTasksMigrated(): Promise<void> {
  const dir = getTasksDir();
  if (!migrationAllowed(dir)) return Promise.resolve();
  return migrateTasksRoot(dir, { runsDir: runsDir() }).then(() => undefined);
}

export function taskMigrationNotice(): string {
  const active = migrationNoticeFor(tasksDir());
  return active || migrationNoticeFor(getTasksDir());
}

function present(task: Task, date: string): Task {
  const notePath = createTaskNoteResolver()(task, date).notePath;
  if (task.jiraKey || !task.links?.some((link) => link.kind === "jira")) return { ...task, notePath };
  const normalized = normalizeTaskLinkState(task.text, task.jiraKey, task.links);
  return { ...task, notePath, text: normalized.text, jiraKey: normalized.jiraKey, links: normalized.links };
}

function canonicalId(id: string): string | null {
  const hit = readItems(tasksDir()).find((task) => taskMatchesId(task, id));
  return hit?.id ?? null;
}

export function getTasks(date?: string): Task[] {
  const target = date ?? todayISO();
  return tasksOnDay(tasksDir(), target, todayISO()).map((task) => present(task, target));
}

export async function addTask(
  text: string,
  date?: string,
  due?: string,
  links?: Task["links"],
  stage?: Task["stage"],
): Promise<Task> {
  await ensureTasksMigrated();
  const startDate = date ?? todayISO();
  const task = await withTaskLock(tasksDir(), () => createTask(tasksDir(), { text, startDate, due, links, stage }));
  return present(task, startDate);
}

export async function toggleTask(taskId: string, date?: string): Promise<Task | null> {
  await ensureTasksMigrated();
  const target = date ?? todayISO();
  const id = canonicalId(taskId);
  if (!id) return null;
  const current = findTask(tasksDir(), id);
  if (!current) return null;
  const task = await withTaskLock(tasksDir(), () => patchTask(tasksDir(), id, { status: current.done ? "reactivate" : "complete" }));
  return task ? present(task, target) : null;
}

export async function abandonTask(taskId: string, reason?: string, date?: string): Promise<Task | null> {
  await ensureTasksMigrated();
  const target = date ?? todayISO();
  const id = canonicalId(taskId);
  if (!id) return null;
  const task = await withTaskLock(tasksDir(), () => patchTask(tasksDir(), id, { status: "abandon", abandonReason: reason }));
  return task ? present(task, target) : null;
}

export async function reactivateTask(taskId: string, date?: string): Promise<Task | null> {
  await ensureTasksMigrated();
  const target = date ?? todayISO();
  const id = canonicalId(taskId);
  if (!id) return null;
  const task = await withTaskLock(tasksDir(), () => patchTask(tasksDir(), id, { status: "reactivate" }));
  return task ? present(task, target) : null;
}

export async function deleteTask(taskId: string): Promise<boolean> {
  await ensureTasksMigrated();
  const id = canonicalId(taskId);
  if (!id) return false;
  return withTaskLock(tasksDir(), () => removeTask(tasksDir(), id));
}

export async function updateTask(
  taskId: string,
  patch: { text?: string; due?: string | null; links?: Task["links"]; stage?: "draft" | "ready" },
  date?: string,
): Promise<Task | null> {
  await ensureTasksMigrated();
  const target = date ?? todayISO();
  const id = canonicalId(taskId);
  if (!id) return null;
  const existing = findTask(tasksDir(), id);
  if (!existing) return null;
  const next = { ...patch };
  if (patch.links !== undefined) {
    const normalized = normalizeTaskLinkState(patch.text ?? existing.text, existing.jiraKey, patch.links);
    next.text = normalized.text;
    next.links = normalized.links?.length ? normalized.links : [];
  }
  const task = await withTaskLock(tasksDir(), () => patchTask(tasksDir(), id, next));
  return task ? present(task, target) : null;
}

export async function reorderOpenTasks(taskIds: string[], date?: string): Promise<Task[]> {
  await ensureTasksMigrated();
  const target = date ?? todayISO();
  const tasks = await withTaskLock(tasksDir(), () => reorderItems(tasksDir(), taskIds, target, todayISO()));
  return tasks.map((task) => present(task, target));
}

export async function startTaskTimer(taskId: string, date?: string): Promise<Task | null> {
  await ensureTasksMigrated();
  const target = date ?? todayISO();
  const id = canonicalId(taskId);
  if (!id) return null;
  const task = await withTaskLock(tasksDir(), () => startTimer(tasksDir(), id));
  return task ? present(task, target) : null;
}

export async function stopTaskTimer(taskId: string, date?: string): Promise<Task | null> {
  await ensureTasksMigrated();
  const target = date ?? todayISO();
  const id = canonicalId(taskId);
  if (!id) return null;
  const task = await withTaskLock(tasksDir(), () => stopTimer(tasksDir(), id));
  return task ? present(task, target) : null;
}

export interface TaskDaySummary {
  date: string;
  total: number;
  completed: number;
  abandoned: number;
  moved: number;
  modified: number;
}

export interface TaskDay extends TaskDaySummary {
  tasks: Task[];
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

export function listTaskFiles(): TaskDaySummary[] {
  return listDays(tasksDir(), todayISO()).map(({ date, tasks }) => summarize(date, tasks));
}

export function listTaskDays(): TaskDay[] {
  return listDays(tasksDir(), todayISO()).map(({ date, tasks }) => ({
    ...summarize(date, tasks),
    tasks: tasks.map((task) => present(task, date)),
  }));
}
