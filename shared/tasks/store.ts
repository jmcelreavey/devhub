import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { taskNotePath } from "../task-note/index.ts";
import type { EntityRef } from "../entity-note/index.ts";
import { todayISO } from "./dates.ts";
import { serializeTask } from "./json.ts";
import { isTaskId, itemPath, itemsDir, timerPath } from "./paths.ts";
import { changedRanks, rankBetween } from "./rank.ts";
import type { Task, TaskStage } from "./types.ts";
import { isTaskOpen } from "./types.ts";
import { compareTasks, isOpenOn, isVisibleOn, projectTask, taskMatchesId } from "./view.ts";

const JIRA_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/;

interface CacheEntry {
  signature: string;
  items: Task[];
  errors: string[];
}

const caches = new Map<string, CacheEntry>();
const queues = new Map<string, Promise<unknown>>();

export function invalidateTaskCache(tasksDir: string): void {
  caches.delete(itemsDir(tasksDir));
}

export function withTaskLock<T>(key: string, fn: () => T): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  queues.set(key, run.then(() => undefined, () => undefined));
  return run;
}

function signatureOf(dir: string): string {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return "";
  }
  const parts: string[] = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.endsWith(".local.json")) continue;
    const stat = fs.statSync(path.join(dir, name));
    parts.push(`${name}:${stat.mtimeMs}:${stat.size}`);
  }
  parts.sort();
  return parts.join("|");
}

function parseItem(raw: string): Task | null {
  try {
    const value = JSON.parse(raw) as Partial<Task> & { deleted?: boolean };
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (value.deleted === true) return null;
    if (typeof value.id !== "string" || typeof value.text !== "string") return null;
    const startDate = value.startDate ?? value.createdAt?.slice(0, 10) ?? todayISO();
    return {
      ...value,
      id: value.id,
      text: value.text,
      done: value.done === true,
      startDate,
      rank: value.rank || "1",
      createdAt: value.createdAt ?? `${startDate}T00:00:00.000Z`,
    };
  } catch {
    return null;
  }
}

export function readItems(tasksDir: string): Task[] {
  const dir = itemsDir(tasksDir);
  const signature = signatureOf(dir);
  const cached = caches.get(dir);
  if (cached && cached.signature === signature) return cached.items;
  const items: Task[] = [];
  const errors: string[] = [];
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json") || name.endsWith(".local.json")) continue;
      try {
        const task = parseItem(fs.readFileSync(path.join(dir, name), "utf8"));
        if (task) items.push(task);
        else errors.push(`${name}: unreadable item`);
      } catch (err) {
        errors.push(`${name}: ${err instanceof Error ? err.message : "unreadable item"}`);
      }
    }
  }
  caches.set(dir, { signature, items, errors });
  return items;
}

export function itemReadErrors(tasksDir: string): string[] {
  readItems(tasksDir);
  return caches.get(itemsDir(tasksDir))?.errors ?? [];
}

interface TimerState {
  version: 1;
  taskId: string;
  timerStartedAt: string;
}

function readTimer(tasksDir: string): TimerState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(timerPath(tasksDir), "utf8")) as Partial<TimerState>;
    if (parsed.version !== 1 || typeof parsed.taskId !== "string" || typeof parsed.timerStartedAt !== "string") return null;
    return { version: 1, taskId: parsed.taskId, timerStartedAt: parsed.timerStartedAt };
  } catch {
    return null;
  }
}

function writeTimer(tasksDir: string, timer: TimerState | null): void {
  const file = timerPath(tasksDir);
  if (!timer) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(timer, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function withTimer(tasksDir: string, task: Task): Task {
  const timer = readTimer(tasksDir);
  if (!timer || timer.taskId !== task.id) return task;
  return { ...task, timerStartedAt: timer.timerStartedAt };
}

export function findTask(tasksDir: string, id: string): Task | null {
  return readItems(tasksDir).find((task) => taskMatchesId(task, id)) ?? null;
}

export function writeItem(tasksDir: string, task: Task): boolean {
  const body = serializeTask({ ...task, timerStartedAt: undefined });
  const file = itemPath(tasksDir, task.id);
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === body) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, file);
  invalidateTaskCache(tasksDir);
  return true;
}

export function removeItem(tasksDir: string, id: string): boolean {
  const file = itemPath(tasksDir, id);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file);
  const timer = readTimer(tasksDir);
  if (timer?.taskId === id) writeTimer(tasksDir, null);
  invalidateTaskCache(tasksDir);
  return true;
}

function extractJiraKey(text: string): string | undefined {
  return text.match(JIRA_KEY_RE)?.[1];
}

function nextRank(tasksDir: string): string {
  const open = readItems(tasksDir).filter(isTaskOpen);
  const max = open.reduce<string | null>((best, task) => (best === null || task.rank > best ? task.rank : best), null);
  return rankBetween(max, null);
}

export interface NewTaskInput {
  text: string;
  startDate?: string;
  due?: string;
  links?: EntityRef[];
  stage?: TaskStage;
  id?: string;
  notePath?: string;
  createdAt?: string;
}

export function createTask(tasksDir: string, input: NewTaskInput, now = new Date()): Task {
  const startDate = input.startDate ?? todayISO(now);
  const id = input.id ?? randomUUID();
  const text = input.text;
  const task: Task = {
    id,
    text,
    done: false,
    startDate,
    rank: nextRank(tasksDir),
    createdAt: input.createdAt ?? now.toISOString(),
    jiraKey: extractJiraKey(text),
    ...(input.due ? { due: input.due } : {}),
    ...(input.links && input.links.length > 0 ? { links: input.links } : {}),
    ...(input.stage ? { stage: input.stage } : {}),
  };
  task.notePath = input.notePath ?? taskNotePath({ ...task, date: startDate });
  writeItem(tasksDir, task);
  return withTimer(tasksDir, task);
}

export interface TaskPatch {
  text?: string;
  due?: string | null;
  links?: EntityRef[];
  stage?: "draft" | "ready";
  done?: boolean;
  status?: "complete" | "abandon" | "reactivate";
  abandonReason?: string;
  notePath?: string;
  timeSpentMs?: number;
  jiraKey?: string | null;
}

export function patchTask(tasksDir: string, id: string, patch: TaskPatch, now = new Date()): Task | null {
  const existing = findTask(tasksDir, id);
  if (!existing) return null;
  const task: Task = { ...existing };
  if (typeof patch.text === "string") {
    task.text = patch.text;
    if (patch.jiraKey === undefined) task.jiraKey = extractJiraKey(patch.text);
  }
  if (patch.jiraKey === null) delete task.jiraKey;
  else if (typeof patch.jiraKey === "string") task.jiraKey = patch.jiraKey;
  if (patch.due === null) delete task.due;
  else if (typeof patch.due === "string") task.due = patch.due;
  if (patch.links) task.links = patch.links.length > 0 ? patch.links : undefined;
  if (patch.links && task.links === undefined) delete task.links;
  if (patch.stage === "draft") task.stage = "draft";
  else if (patch.stage === "ready") delete task.stage;
  if (typeof patch.notePath === "string") task.notePath = patch.notePath;
  if (typeof patch.timeSpentMs === "number") task.timeSpentMs = patch.timeSpentMs;

  const finish = (kind: "done" | "abandon") => {
    const day = todayISO(now);
    task.endDate = day;
    delete task.endReason;
    if (kind === "done") {
      task.done = true;
      task.completedAt = now.toISOString();
      delete task.abandonedAt;
      delete task.abandonReason;
    } else {
      task.done = false;
      delete task.completedAt;
      task.abandonedAt = now.toISOString();
      task.abandonReason = patch.abandonReason || undefined;
      if (!task.abandonReason) delete task.abandonReason;
    }
  };
  const reopen = () => {
    task.done = false;
    delete task.endDate;
    delete task.completedAt;
    delete task.abandonedAt;
    delete task.abandonReason;
    delete task.endReason;
  };

  if (patch.status === "complete" || patch.done === true) finish("done");
  else if (patch.status === "abandon") finish("abandon");
  else if (patch.status === "reactivate" || patch.done === false) reopen();

  writeItem(tasksDir, task);
  return withTimer(tasksDir, task);
}

export interface Tombstone {
  id: string;
  deleted: true;
  legacyIds: string[];
  legacyThrough?: string;
}

export function deletedDir(tasksDir: string): string {
  return path.join(tasksDir, "deleted");
}

export function readTombstones(tasksDir: string): Tombstone[] {
  const dir = deletedDir(tasksDir);
  if (!fs.existsSync(dir)) return [];
  const out: Tombstone[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const value = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as Partial<Tombstone>;
      if (!value || value.deleted !== true || typeof value.id !== "string") continue;
      const legacyIds = Array.isArray(value.legacyIds) ? value.legacyIds.filter((id): id is string => typeof id === "string") : [];
      out.push({
        id: value.id,
        deleted: true,
        legacyIds: [...new Set([value.id, ...legacyIds])].sort(),
        ...(typeof value.legacyThrough === "string" ? { legacyThrough: value.legacyThrough } : {}),
      });
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function writeTombstone(tasksDir: string, tombstone: Tombstone): void {
  if (!isTaskId(tombstone.id)) return;
  const file = path.join(deletedDir(tasksDir), `${tombstone.id}.json`);
  const body = `${JSON.stringify({
    id: tombstone.id,
    deleted: true,
    legacyIds: [...tombstone.legacyIds].sort(),
    ...(tombstone.legacyThrough ? { legacyThrough: tombstone.legacyThrough } : {}),
  }, null, 2)}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, file);
}

export function deleteTask(tasksDir: string, id: string): boolean {
  const existing = findTask(tasksDir, id);
  if (!existing) return false;
  const legacyIds = [...new Set([existing.id, ...(existing.legacyIds ?? [])])].sort();
  const removed = removeItem(tasksDir, existing.id);
  if (removed && (existing.legacyIds?.length || existing.legacyThrough)) {
    writeTombstone(tasksDir, {
      id: existing.id,
      deleted: true,
      legacyIds,
      ...(existing.legacyThrough ? { legacyThrough: existing.legacyThrough } : {}),
    });
  }
  return removed;
}

export function tasksOnDay(tasksDir: string, day: string, today = todayISO()): Task[] {
  const timer = readTimer(tasksDir);
  return readItems(tasksDir)
    .filter((task) => isVisibleOn(task, day, today))
    .sort((a, b) => compareTasks(a, b, day))
    .map((task) => {
      const view = projectTask(task, day);
      if (timer && timer.taskId === task.id && isOpenOn(task, day)) view.timerStartedAt = timer.timerStartedAt;
      return view;
    });
}

export function listOpenTasks(tasksDir: string, today = todayISO()): Task[] {
  return tasksOnDay(tasksDir, today, today).filter((task) => isTaskOpen(task) || (!task.done && !task.abandonedAt && !task.endDate));
}

export interface DayBucket {
  date: string;
  tasks: Task[];
}

export function listDays(tasksDir: string, today = todayISO()): DayBucket[] {
  const items = readItems(tasksDir);
  if (items.length === 0) return [];
  let min = today;
  let max = today;
  for (const task of items) {
    if (task.startDate < min) min = task.startDate;
    const end = task.endDate ?? (task.startDate > today ? task.startDate : today);
    if (end > max) max = end;
  }
  const days: DayBucket[] = [];
  for (let day = max; day >= min; day = previousDay(day)) {
    const tasks = tasksOnDay(tasksDir, day, today);
    if (tasks.length > 0) days.push({ date: day, tasks });
    if (day === min) break;
  }
  return days;
}

function previousDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function reorderOpenTasks(tasksDir: string, orderedIds: readonly string[], day: string, today = todayISO()): Task[] {
  const open = readItems(tasksDir).filter((task) => isVisibleOn(task, day, today) && isOpenOn(task, day));
  const openIds = new Set(open.map((task) => task.id));
  if (orderedIds.length !== open.length || new Set(orderedIds).size !== orderedIds.length || orderedIds.some((id) => !openIds.has(id))) {
    throw new Error("Task order must include every open task exactly once.");
  }
  const changes = changedRanks(open, orderedIds);
  for (const [id, rank] of changes) {
    const task = open.find((item) => item.id === id);
    if (task) writeItem(tasksDir, { ...task, rank });
  }
  return tasksOnDay(tasksDir, day, today);
}

function settleTimer(tasksDir: string, taskId: string, nowMs: number): void {
  const timer = readTimer(tasksDir);
  if (!timer || timer.taskId !== taskId) return;
  const task = findTask(tasksDir, taskId);
  writeTimer(tasksDir, null);
  if (!task) return;
  const started = Date.parse(timer.timerStartedAt);
  const elapsed = Number.isFinite(started) ? Math.max(0, nowMs - started) : 0;
  writeItem(tasksDir, { ...task, timeSpentMs: (task.timeSpentMs ?? 0) + elapsed });
}

export function startTimer(tasksDir: string, id: string, now = new Date()): Task | null {
  const task = findTask(tasksDir, id);
  if (!task || !isTaskOpen(task)) return null;
  const current = readTimer(tasksDir);
  if (current && current.taskId !== task.id) settleTimer(tasksDir, current.taskId, now.getTime());
  if (!current || current.taskId !== task.id) {
    writeTimer(tasksDir, { version: 1, taskId: task.id, timerStartedAt: now.toISOString() });
  }
  return withTimer(tasksDir, findTask(tasksDir, task.id)!);
}

export function stopTimer(tasksDir: string, id: string, now = new Date()): Task | null {
  const task = findTask(tasksDir, id);
  if (!task) return null;
  const timer = readTimer(tasksDir);
  if (timer?.taskId === task.id) settleTimer(tasksDir, task.id, now.getTime());
  return findTask(tasksDir, task.id);
}

/** Open tasks in a profile directory (after items exist). */
export function openItems(tasksDir: string, today = todayISO()): Task[] {
  return readItems(tasksDir).filter((task) => isTaskOpen(task) && task.startDate <= today).sort((a, b) => a.rank.localeCompare(b.rank) || a.id.localeCompare(b.id));
}
