import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getActiveTasksDir } from "@/lib/notes/dir";
import { writeAtomic, safeReadJSON, withMutex } from "@/lib/atomic-write";
import { todayISO, JIRA_KEY_RE } from "@/lib/utils";
import { normalizeTaskLinkState, taskNotePath } from "@/lib/task-note";
import { createTaskNoteResolver } from "./task-notes";
import { currentTaskNode, loadTaskIndex, taskLineageIds, type TaskNode } from "./task-index";
import { relinkTaskAgentRuns } from "@/lib/tasks/task-agent-runs";

// Canonical shape lives in ./types so client components can import it too
// (this module imports node:fs and cannot be reached from the browser).
export type { Task } from "@/lib/tasks/types";
import type { Task } from "@/lib/tasks/types";
import { isTaskOpen } from "@/lib/tasks/types";


export { isTaskOpen } from "@/lib/tasks/types";

function tasksDir(): string {
  return getActiveTasksDir();
}

function tasksFile(date: string): string {
  return path.join(tasksDir(), `${date}.json`);
}

function extractJiraKey(text: string): string | undefined {
  const m = text.match(JIRA_KEY_RE);
  return m ? m[1] : undefined;
}

export function getTasks(date?: string): Task[] {
  const target = date ?? todayISO();
  const resolveNotes = createTaskNoteResolver();
  return safeReadJSON<Task[]>(tasksFile(target), []).map((task) => {
    const notePath = resolveNotes(task, target).notePath;
    if (task.jiraKey || !task.links?.some((l) => l.kind === "jira")) return { ...task, notePath };
    const normalized = normalizeTaskLinkState(task.text, task.jiraKey, task.links);
    return { ...task, notePath, text: normalized.text, jiraKey: normalized.jiraKey, links: normalized.links };
  });
}

/** Past task days (before `beforeDate`) that still have open tasks. Oldest first. */
export function listPastDatesWithOpenTasks(beforeDate: string): string[] {
  const dir = tasksDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .filter((d) => d < beforeDate)
    .sort()
    .filter((d) => safeReadJSON<Task[]>(tasksFile(d), []).some(isTaskOpen));
}

export async function rolloverTasks(): Promise<Task[]> {
  const today = todayISO();
  const todayFile = tasksFile(today);

  return withMutex(todayFile, async () => {
    let todayTasks = getTasks(today);
    const pastDates = listPastDatesWithOpenTasks(today);
    if (pastDates.length === 0) return todayTasks;
    const index = loadTaskIndex();
    const now = new Date().toISOString();

    // Newest first: after an interrupted rollover, the latest snapshot owns the task.
    for (const date of pastDates.reverse()) {
      await withMutex(tasksFile(date), async () => {
        const sourceTasks = getTasks(date);
        const openTasks = sourceTasks.filter(isTaskOpen);
        if (openTasks.length === 0) return;
        const destinations = new Map<string, TaskNode>();
        const additions: Task[] = [];

        for (const source of openTasks) {
          const latest = currentTaskNode(index, source.id);
          if (latest && latest.date > date && latest.date <= today && !isTaskOpen(latest.task)) {
            destinations.set(source.id, latest);
            continue;
          }
          const aliases = taskLineageIds(index, source.id);
          const existing = [...todayTasks, ...additions].find((task) => aliases.has(task.id));
          if (existing) {
            destinations.set(source.id, { task: existing, date: today });
            continue;
          }
          const snapshot = { ...source };
          delete snapshot.movedAt;
          delete snapshot.movedToDate;
          additions.push(snapshot);
          destinations.set(source.id, { task: snapshot, date: today });
        }

        // Destination first, source second. A failed source write is retried using
        // the same IDs; rolling back the destination can lose already-moved tasks.
        if (additions.length > 0) {
          const merged = [...todayTasks, ...additions];
          await saveTasks(today, merged);
          todayTasks = merged;
        }
        for (const source of openTasks) {
          const destination = destinations.get(source.id)!;
          // Only needed to finish a rollover interrupted under the old UUID scheme.
          if (source.id !== destination.task.id) await relinkTaskAgentRuns(source.id, destination.task.id);
          source.movedAt = now;
          source.movedToDate = destination.date;
          delete source.timerStartedAt;
        }
        await saveTasks(date, sourceTasks);
      });
    }
    return todayTasks;
  });
}

export async function saveTasks(date: string, tasks: Task[]): Promise<void> {
  await writeAtomic(tasksFile(date), JSON.stringify(tasks, null, 2));
}

export async function addTask(
  text: string,
  date?: string,
  due?: string,
  links?: Task["links"],
  stage?: Task["stage"],
): Promise<Task> {
  const target = date ?? todayISO();
  return withMutex(tasksFile(target), async () => {
    const tasks = getTasks(target);
    const task: Task = {
      id: randomUUID(),
      text,
      done: false,
      jiraKey: extractJiraKey(text),
      due,
      createdAt: new Date().toISOString(),
      ...(links && links.length > 0 ? { links } : {}),
      ...(stage ? { stage } : {}),
    };
    task.notePath = taskNotePath({ ...task, date: target });
    tasks.push(task);
    await saveTasks(target, tasks);
    return task;
  });
}

export async function toggleTask(taskId: string, date?: string): Promise<Task | null> {
  const target = date ?? todayISO();
  return withMutex(tasksFile(target), async () => {
    const tasks = getTasks(target);
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.movedAt) return null;
    task.done = !task.done;
    task.completedAt = task.done ? new Date().toISOString() : undefined;
    if (task.done) {
      task.abandonedAt = undefined;
      task.abandonReason = undefined;
    }
    await saveTasks(target, tasks);
    return task;
  });
}

export async function abandonTask(
  taskId: string,
  reason?: string,
  date?: string,
): Promise<Task | null> {
  const target = date ?? todayISO();
  return withMutex(tasksFile(target), async () => {
    const tasks = getTasks(target);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return null;
    task.done = false;
    task.completedAt = undefined;
    task.abandonedAt = new Date().toISOString();
    task.abandonReason = reason || undefined;
    await saveTasks(target, tasks);
    return task;
  });
}

export async function reactivateTask(taskId: string, date?: string): Promise<Task | null> {
  const target = date ?? todayISO();
  return withMutex(tasksFile(target), async () => {
    const tasks = getTasks(target);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return null;
    task.done = false;
    task.completedAt = undefined;
    task.abandonedAt = undefined;
    task.abandonReason = undefined;
    await saveTasks(target, tasks);
    return task;
  });
}

export async function deleteTask(taskId: string, date?: string): Promise<boolean> {
  const target = date ?? todayISO();
  return withMutex(tasksFile(target), async () => {
    const tasks = getTasks(target);
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) return false;
    tasks.splice(idx, 1);
    await saveTasks(target, tasks);
    return true;
  });
}

export async function updateTask(
  taskId: string,
  patch: { text?: string; due?: string | null; links?: Task["links"]; stage?: "draft" | "ready" },
  date?: string,
): Promise<Task | null> {
  const target = date ?? todayISO();
  return withMutex(tasksFile(target), async () => {
    const tasks = getTasks(target);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return null;
    if (typeof patch.text === "string") {
      task.text = patch.text;
      task.jiraKey = extractJiraKey(patch.text);
    }
    if (patch.due === null) {
      task.due = undefined;
    } else if (typeof patch.due === "string") {
      task.due = patch.due;
    }
    if (patch.stage === "draft") task.stage = "draft";
    else if (patch.stage === "ready") delete task.stage;
    if (patch.links !== undefined) {
      const normalized = normalizeTaskLinkState(task.text, task.jiraKey, patch.links);
      task.text = normalized.text;
      task.jiraKey = normalized.jiraKey;
      task.links = normalized.links;
    }
    await saveTasks(target, tasks);
    return task;
  });
}

export async function reorderOpenTasks(taskIds: string[], date?: string): Promise<Task[]> {
  const target = date ?? todayISO();
  return withMutex(tasksFile(target), async () => {
    const tasks = getTasks(target);
    const openTasks = tasks.filter(isTaskOpen);
    const openIds = new Set(openTasks.map((task) => task.id));
    const requestedIds = new Set(taskIds);
    if (
      taskIds.length !== openTasks.length ||
      requestedIds.size !== taskIds.length ||
      taskIds.some((id) => !openIds.has(id))
    ) {
      throw new Error("Task order must include every open task exactly once.");
    }

    const orderedOpen = new Map(openTasks.map((task) => [task.id, task]));
    const nextOpen = taskIds.map((id) => orderedOpen.get(id)!);
    let openIndex = 0;
    const nextTasks = tasks.map((task) => (isTaskOpen(task) ? nextOpen[openIndex++]! : task));
    await saveTasks(target, nextTasks);
    return nextTasks;
  });
}

/** Fold a running timer into timeSpentMs and clear it. Mutates the task. */
function settleTimer(task: Task, nowMs: number): void {
  if (!task.timerStartedAt) return;
  const started = Date.parse(task.timerStartedAt);
  if (Number.isFinite(started)) {
    task.timeSpentMs = (task.timeSpentMs ?? 0) + Math.max(0, nowMs - started);
  }
  task.timerStartedAt = undefined;
}

/** Start the timer on a task, stopping any other running timer that day (single active). */
export async function startTaskTimer(taskId: string, date?: string): Promise<Task | null> {
  const target = date ?? todayISO();
  return withMutex(tasksFile(target), async () => {
    const tasks = getTasks(target);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return null;
    const now = Date.now();
    for (const other of tasks) {
      if (other.id !== taskId) settleTimer(other, now);
    }
    if (!task.timerStartedAt) {
      task.timerStartedAt = new Date(now).toISOString();
    }
    await saveTasks(target, tasks);
    return task;
  });
}

/** Stop the timer on a task, folding elapsed time into timeSpentMs. */
export async function stopTaskTimer(taskId: string, date?: string): Promise<Task | null> {
  const target = date ?? todayISO();
  return withMutex(tasksFile(target), async () => {
    const tasks = getTasks(target);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return null;
    settleTimer(task, Date.now());
    await saveTasks(target, tasks);
    return task;
  });
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

function summarizeTaskDay(date: string, fp: string, tasks: Task[]): TaskDaySummary {
  const stat = fs.statSync(fp);
  return {
    date,
    total: tasks.length,
    completed: tasks.filter((t) => t.done).length,
    abandoned: tasks.filter((t) => !!t.abandonedAt).length,
    moved: tasks.filter((t) => !!t.movedAt).length,
    modified: stat.mtimeMs,
  };
}

export function listTaskFiles(): TaskDaySummary[] {
  const dir = tasksDir();
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().reverse();
  return files.map((f) => {
    const date = f.replace(".json", "");
    const fp = path.join(dir, f);
    const tasks: Task[] = safeReadJSON(fp, []);
    return summarizeTaskDay(date, fp, tasks);
  });
}

/** Mark open tasks on day N as moved when the same text appears on day N+1 (rollover backfill). */
export async function backfillMovedTasks(): Promise<{ updated: number }> {
  const dir = tasksDir();
  if (!fs.existsSync(dir)) return { updated: 0 };

  const dates = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .sort();

  let updated = 0;
  for (let i = 0; i < dates.length - 1; i++) {
    const day = dates[i]!;
    const nextDay = dates[i + 1]!;
    const tasks = getTasks(day);
    const nextTexts = new Set(getTasks(nextDay).map((t) => t.text.trim()));
    let changed = false;
    const movedAt = new Date(fs.statSync(tasksFile(nextDay)).mtimeMs).toISOString();

    for (const task of tasks) {
      if (isTaskOpen(task) && nextTexts.has(task.text.trim())) {
        task.movedAt = movedAt;
        task.movedToDate = nextDay;
        updated++;
        changed = true;
      }
    }

    if (changed) {
      await saveTasks(day, tasks);
    }
  }

  return { updated };
}

export function listTaskDays(): TaskDay[] {
  const resolveNotes = createTaskNoteResolver();
  const dir = tasksDir();
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().reverse();
  return files.map((f) => {
    const date = f.replace(".json", "");
    const fp = path.join(dir, f);
    const tasks: Task[] = safeReadJSON(fp, []);
    return {
      ...summarizeTaskDay(date, fp, tasks),
      tasks: tasks.map((task) => ({ ...task, notePath: resolveNotes(task, date).notePath })),
    };
  });
}
