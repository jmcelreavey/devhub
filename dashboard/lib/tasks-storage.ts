import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getTasksDir } from "./notes-dir";
import { writeAtomic, safeReadJSON, withMutex } from "./atomic-write";
import { todayISO, JIRA_KEY_RE } from "./utils";

export interface Task {
  id: string;
  text: string;
  done: boolean;
  jiraKey?: string;
  due?: string;
  createdAt: string;
  completedAt?: string;
  abandonedAt?: string;
  abandonReason?: string;
  movedAt?: string;
  movedToDate?: string;
  /** Committed time spent on the task, in ms. */
  timeSpentMs?: number;
  /** ISO timestamp the running timer started; absent when no timer is running. */
  timerStartedAt?: string;
  /** Source task id when this row was created by rollover (idempotency on crash/retry). */
  rolledFromId?: string;
  /** Source date when this row was created by rollover. */
  rolledFromDate?: string;
}

export function isTaskOpen(task: Task): boolean {
  return !task.done && !task.abandonedAt && !task.movedAt;
}

function tasksDir(): string {
  return getTasksDir();
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
  const file = tasksFile(target);
  return safeReadJSON<Task[]>(file, []);
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
    .filter((d) => getTasks(d).some(isTaskOpen));
}

export async function rolloverTasks(): Promise<Task[]> {
  const today = todayISO();
  const todayFile = tasksFile(today);

  // Serialize rollover — /api/tasks and /api/sidebar/counts both call this on load.
  return withMutex(todayFile, async () => {
    const existingToday = fs.existsSync(todayFile) ? getTasks(today) : [];
    const pastDates = listPastDatesWithOpenTasks(today);

    if (pastDates.length === 0) {
      return existingToday;
    }

    const now = new Date().toISOString();
    const allCopies: Task[] = [];
    const datesToMark: Array<{ date: string; taskIds: string[] }> = [];

    for (const date of pastDates) {
      await withMutex(tasksFile(date), async () => {
        const dayTasks = getTasks(date);
        const toRoll = dayTasks.filter(isTaskOpen);
        if (toRoll.length === 0) return;

        const alreadyRolledIds = new Set(
          [...existingToday, ...allCopies]
            .filter((task) => task.rolledFromDate === date && task.rolledFromId)
            .map((task) => task.rolledFromId!),
        );
        const pendingRoll = toRoll.filter((task) => !alreadyRolledIds.has(task.id));

        // Crash recovery: today's copies exist but the source day was never marked moved.
        if (pendingRoll.length === 0) {
          let changed = false;
          for (const task of toRoll) {
            if (!task.movedAt) {
              task.movedAt = now;
              task.movedToDate = today;
              changed = true;
            }
          }
          if (changed) {
            await saveTasks(date, dayTasks);
          }
          return;
        }

        const copies = pendingRoll.map((t) => {
          const rest = { ...t };
          delete rest.movedAt;
          delete rest.movedToDate;
          delete rest.rolledFromId;
          delete rest.rolledFromDate;
          return {
            ...rest,
            id: randomUUID(),
            createdAt: now,
            rolledFromId: t.id,
            rolledFromDate: date,
          };
        });
        allCopies.push(...copies);
        datesToMark.push({ date, taskIds: toRoll.map((t) => t.id) });
      });
    }

    if (allCopies.length === 0) {
      return existingToday;
    }

    const merged = [...existingToday, ...allCopies];

    // Write today before marking source days moved. If today's save fails, sources
    // must stay open — marking first made tasks vanish from both days on retry.
    await saveTasks(today, merged);

    for (const { date, taskIds } of datesToMark) {
      await withMutex(tasksFile(date), async () => {
        const dayTasks = getTasks(date);
        const markIds = new Set(taskIds);
        let changed = false;
        for (const task of dayTasks) {
          if (!isTaskOpen(task) || !markIds.has(task.id)) continue;
          task.movedAt = now;
          task.movedToDate = today;
          changed = true;
        }
        if (changed) {
          try {
            await saveTasks(date, dayTasks);
          } catch (err) {
            await saveTasks(today, existingToday).catch(() => undefined);
            throw err;
          }
        }
      });
    }

    return merged;
  });
}

export async function saveTasks(date: string, tasks: Task[]): Promise<void> {
  await writeAtomic(tasksFile(date), JSON.stringify(tasks, null, 2));
}

export async function addTask(text: string, date?: string, due?: string): Promise<Task> {
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
    };
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
    if (!task) return null;
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
  patch: { text?: string; due?: string | null },
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
  const dir = tasksDir();
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().reverse();
  return files.map((f) => {
    const date = f.replace(".json", "");
    const fp = path.join(dir, f);
    const tasks: Task[] = safeReadJSON(fp, []);
    return {
      ...summarizeTaskDay(date, fp, tasks),
      tasks,
    };
  });
}
