import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listTaskProfiles } from "../vault/task-profiles.ts";
import { collapseRows, dedupeRows, droppedRowCount, rowsFromJson, type ChainPlan, type LegacyRow } from "./chains.ts";
import { isDay } from "./dates.ts";
import { fingerprintFiles, legacyFileDate, listLegacyFiles, sha256 } from "./paths.ts";
import { rankBetween } from "./rank.ts";
import { relinkMigratedRuns } from "./runs.ts";
import { invalidateTaskCache, readItems, readTombstones, removeItem, writeItem, type Tombstone } from "./store.ts";
import type { Task } from "./types.ts";
import { isTaskOpen } from "./types.ts";

const migrationNotices = new Map<string, string>();
const migrations = new Map<string, Promise<MigrationReport>>();
const rootMigrations = new Map<string, Promise<MigrationReport>>();

export function migrationNoticeFor(tasksDir: string): string {
  return migrationNotices.get(path.resolve(tasksDir)) ?? "";
}

function rememberNotice(tasksDir: string, notice: string): void {
  if (notice) migrationNotices.set(path.resolve(tasksDir), notice);
}

export interface MigrationConflict {
  id: string;
  text: string;
  detail: string;
}

export interface ChainSample {
  text: string;
  startDate: string;
  endDate?: string;
  endReason?: string;
  legacyIds: string[];
  days: string[];
}

export interface MigrationReport {
  tasksDir: string;
  skipped: boolean;
  dryRun: boolean;
  legacyFiles: number;
  legacyRows: number;
  chains: number;
  collapsed: number;
  items: number;
  open: number;
  done: number;
  abandoned: number;
  endedByMove: number;
  keptDeleted: number;
  dropped: number;
  ambiguous: number;
  /** Rows folded into an identical (date, id) row from another copy of the same day file. */
  duplicateRows: number;
  conflicts: MigrationConflict[];
  samples: ChainSample[];
  endedByMoveSamples: ChainSample[];
  problems: string[];
  unreadable: string[];
  notice: string;
}

export interface PlannedMigration {
  report: MigrationReport;
  items: Task[];
  rows: LegacyRow[];
  suppressed: ChainPlan[];
}

function migrationHome(): string {
  if (process.env.DEVHUB_TASK_MIGRATION_DIR) return process.env.DEVHUB_TASK_MIGRATION_DIR;
  if (process.env.NODE_ENV === "test") return path.join(os.tmpdir(), "devhub-task-migration");
  const config = process.env.DEVHUB_CONFIG_DIR || path.join(os.homedir(), ".config", "devhub");
  return path.join(config, "task-migrations");
}

function stateDir(tasksDir: string): string {
  let real = tasksDir;
  try {
    real = fs.realpathSync(tasksDir);
  } catch {
    real = path.resolve(tasksDir);
  }
  return path.join(migrationHome(), sha256(real));
}

interface MigrationState {
  fingerprint: string;
  backedUp?: boolean;
  backupPath?: string;
}

function readState(tasksDir: string): MigrationState | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir(tasksDir), "state.json"), "utf8")) as MigrationState;
  } catch {
    return null;
  }
}

function writeState(tasksDir: string, state: MigrationState): void {
  const dir = stateDir(tasksDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lockIsStale(lock: string): boolean {
  try {
    const stat = fs.statSync(lock);
    const pid = Number(fs.readFileSync(lock, "utf8").split("\n")[0]);
    let alive = false;
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        alive = true;
      } catch (err) {
        alive = (err as NodeJS.ErrnoException).code === "EPERM";
      }
    }
    if (!alive) return true;
    return Date.now() - stat.mtimeMs > 20_000;
  } catch {
    return true;
  }
}

async function acquireLock(tasksDir: string): Promise<void> {
  const dir = stateDir(tasksDir);
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, "lock");
  const started = Date.now();
  for (;;) {
    try {
      const fd = fs.openSync(lock, "wx");
      fs.writeSync(fd, `${process.pid}\n${Date.now()}\n`);
      fs.closeSync(fd);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (lockIsStale(lock)) {
        fs.rmSync(lock, { force: true });
        continue;
      }
      if (Date.now() - started > 20_000) throw new Error(`Task migration is busy for ${tasksDir}`);
      await sleep(25);
    }
  }
}

function releaseLock(tasksDir: string): void {
  const lock = path.join(stateDir(tasksDir), "lock");
  try {
    if (fs.readFileSync(lock, "utf8").startsWith(`${process.pid}\n`)) fs.rmSync(lock, { force: true });
  } catch {
    /* already released */
  }
}

export function loadLegacyFiles(files: readonly string[], labelFor: (file: string) => string): { rows: LegacyRow[]; problems: string[]; unreadable: string[] } {
  const rows: LegacyRow[] = [];
  const problems: string[] = [];
  const unreadable: string[] = [];
  for (const file of files) {
    const label = labelFor(file);
    const date = legacyFileDate(file);
    if (!date || !isDay(date)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      problems.push(`${label}: invalid JSON`);
      unreadable.push(file);
      continue;
    }
    const before = problems.length;
    const parsedRows = rowsFromJson(parsed, date, label, problems);
    if (parsedRows.length === 0 && problems.length > before) unreadable.push(file);
    rows.push(...parsedRows);
  }
  return { rows, problems, unreadable };
}

type Closure = "done" | "abandoned" | "open" | "moved";

function closureOf(task: Task): Closure {
  if (task.done || task.completedAt) return "done";
  if (task.abandonedAt) return "abandoned";
  if (task.endDate || task.endReason === "legacy-moved") return "moved";
  return "open";
}

function rowIsOpen(row: LegacyRow): boolean {
  return row.task.done !== true && !row.task.abandonedAt && !row.task.movedAt;
}

function closureOfRows(rows: LegacyRow[]): Closure | null {
  if (rows.length === 0) return null;
  if (rows.some((row) => row.task.done)) return "done";
  if (rows.some((row) => row.task.abandonedAt)) return "abandoned";
  if (rows.some(rowIsOpen)) return "open";
  return "moved";
}

const CLOSURE_RANK: Record<Closure, number> = { done: 3, abandoned: 2, open: 1, moved: 0 };

function latestRow(rows: LegacyRow[]): LegacyRow | undefined {
  return [...rows].sort((a, b) => b.date.localeCompare(a.date) || b.index - a.index)[0];
}

function earliestStamp(rows: LegacyRow[], stamp: (row: LegacyRow) => string): LegacyRow {
  return [...rows].sort((a, b) => stamp(a).localeCompare(stamp(b)) || a.date.localeCompare(b.date) || a.index - b.index)[0]!;
}

function applyEditable(task: Task, row: LegacyRow | undefined): void {
  if (!row) return;
  task.text = row.task.text;
  if (row.task.jiraKey) task.jiraKey = row.task.jiraKey;
  if (row.task.due) task.due = row.task.due;
  if (row.task.notePath) task.notePath = row.task.notePath;
  if (row.task.links?.length) task.links = row.task.links;
  if (row.task.stage) task.stage = row.task.stage;
  if (row.task.extra) {
    for (const [key, value] of Object.entries(row.task.extra)) (task as unknown as Record<string, unknown>)[key] = value;
  }
}

function clearClosure(task: Task): void {
  task.done = false;
  delete task.endDate;
  delete task.endReason;
  delete task.completedAt;
  delete task.abandonedAt;
  delete task.abandonReason;
}

function applyDone(task: Task, row: LegacyRow): void {
  task.done = true;
  task.completedAt = row.task.completedAt ?? `${row.date}T00:00:00.000Z`;
  task.endDate = row.date;
  delete task.endReason;
  delete task.abandonedAt;
  delete task.abandonReason;
}

function applyAbandoned(task: Task, row: LegacyRow): void {
  task.done = false;
  delete task.completedAt;
  delete task.endReason;
  task.abandonedAt = row.task.abandonedAt ?? `${row.date}T00:00:00.000Z`;
  task.abandonReason = row.task.abandonReason;
  task.endDate = row.date;
  if (!task.abandonReason) delete task.abandonReason;
}

function applyMoved(task: Task, endDate: string): void {
  task.done = false;
  delete task.completedAt;
  delete task.abandonedAt;
  delete task.abandonReason;
  task.endDate = endDate;
  task.endReason = "legacy-moved";
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, current: unknown) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return current;
    const record = current as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
  });
}

function legacyRowKey(row: LegacyRow): string {
  return `${row.date}\0${row.task.id}`;
}

function readLegacyDigests(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.every(([digest, closure]) => /^[a-f0-9]{64}$/.test(digest) && typeof closure === "string" && /^[a-f0-9]{64}$/.test(closure))) return null;
  return value as Record<string, string>;
}

function mergeTask(previous: Task | null, plan: ChainPlan, rows: LegacyRow[]): Task {
  const desired = plan.task;
  const remembered = readLegacyDigests(previous?.legacyRowDigests);
  const snapshots = rows.map((row) => {
    const moved = row.task.movedAt ? true : undefined;
    return {
      row,
      digest: sha256(canonicalJson([row.date, { ...row.task, movedAt: moved }])),
      closure: sha256(canonicalJson([row.date, row.task.id, row.task.done, row.task.completedAt, row.task.abandonedAt, moved, row.task.movedToDate])),
    };
  });
  const legacyRowDigests = Object.fromEntries(Object.entries({
    ...remembered,
    ...Object.fromEntries(snapshots.map(({ digest, closure }) => [digest, closure])),
  }).sort(([left], [right]) => left.localeCompare(right)));
  const metadata = { legacyDigest: sha256(canonicalJson(legacyRowDigests)), legacyRowDigests };
  if (!previous) return { ...desired, ...metadata };
  if (remembered && metadata.legacyDigest === previous.legacyDigest) return previous;

  const changed = snapshots.filter(({ row, digest }) => remembered
    ? !Object.hasOwn(remembered, digest)
    : row.date > (previous.legacyThrough ?? ""));
  if (changed.length === 0) return remembered ? previous : { ...previous, ...metadata };
  const newer = dedupeRows(changed.map(({ row }) => row)).rows;
  const knownClosures = new Set(Object.values(remembered ?? {}));
  const closures = dedupeRows(changed.filter(({ closure }) => !knownClosures.has(closure)).map(({ row }) => row)).rows;
  const incoming = closureOfRows(closures);
  const prevC = closureOf(previous);
  const status: Closure = incoming && CLOSURE_RANK[incoming] > CLOSURE_RANK[prevC] ? incoming : prevC;
  const task: Task = { ...previous, id: previous.id, rank: previous.rank || desired.rank };
  const editable = closureOfRows(newer);
  if (editable && CLOSURE_RANK[editable] >= CLOSURE_RANK[prevC]) {
    if (editable === "open") applyEditable(task, latestRow(newer.filter(rowIsOpen)));
    else if (editable === "done") applyEditable(task, latestRow(newer.filter((row) => row.task.done)));
    else if (editable === "abandoned") applyEditable(task, latestRow(newer.filter((row) => row.task.abandonedAt)));
    else applyEditable(task, latestRow(newer));
  }

  const times = [previous.timeSpentMs, ...newer.map((row) => row.task.timeSpentMs)].filter((value): value is number => typeof value === "number");
  task.legacyIds = [...new Set([...(previous.legacyIds ?? []), ...(desired.legacyIds ?? []), previous.id, desired.id])].sort();
  task.legacyThrough = (previous.legacyThrough ?? "") > (desired.legacyThrough ?? "") ? previous.legacyThrough : desired.legacyThrough;
  task.startDate = previous.startDate < desired.startDate ? previous.startDate : desired.startDate;
  task.createdAt = previous.createdAt < desired.createdAt ? previous.createdAt : desired.createdAt;
  if (times.length > 0) task.timeSpentMs = Math.max(...times);

  if (status === "done") {
    const newerDone = closures.filter((row) => row.task.done);
    if (newerDone.length > 0) {
      const earliest = earliestStamp(newerDone, (row) => row.task.completedAt ?? `${row.date}T23:59:59.999Z`);
      const previousEarlier = prevC === "done" && (previous.completedAt ?? "") <= (earliest.task.completedAt ?? `${earliest.date}T23:59:59.999Z`);
      if (!previousEarlier) applyDone(task, earliest);
    }
  } else if (status === "abandoned") {
    const newerAbandoned = closures.filter((row) => row.task.abandonedAt);
    if (newerAbandoned.length > 0) {
      const earliest = earliestStamp(newerAbandoned, (row) => row.task.abandonedAt ?? `${row.date}T23:59:59.999Z`);
      const previousEarlier = prevC === "abandoned" && (previous.abandonedAt ?? "") <= (earliest.task.abandonedAt ?? `${earliest.date}T23:59:59.999Z`);
      if (!previousEarlier) applyAbandoned(task, earliest);
    }
  } else if (status === "moved") {
    if (incoming === "moved") applyMoved(task, desired.endDate ?? desired.legacyThrough ?? desired.startDate);
  } else {
    clearClosure(task);
  }
  if (!task.links?.length) delete task.links;
  return { ...task, ...metadata };
}

function matchesTombstone(plan: ChainPlan, tombstones: readonly Tombstone[]): boolean {
  const ids = new Set(plan.task.legacyIds ?? []);
  ids.add(plan.task.id);
  return tombstones.some((tomb) => ids.has(tomb.id) || tomb.legacyIds.some((id) => ids.has(id)));
}

function assignRanks(plans: ChainPlan[], existing: Map<string, Task>, tombstones: readonly Tombstone[], rows: LegacyRow[]): { items: Task[]; suppressed: ChainPlan[] } {
  const suppressed = plans.filter((plan) => matchesTombstone(plan, tombstones));
  const live = plans.filter((plan) => !matchesTombstone(plan, tombstones));
  const rowsByKey = new Map<string, LegacyRow[]>();
  for (const row of rows) {
    const key = legacyRowKey(row);
    const copies = rowsByKey.get(key) ?? [];
    copies.push(row);
    rowsByKey.set(key, copies);
  }
  const decorated = live.map((plan) => {
    const previous = matchExisting(plan, existing);
    const copies = plan.rows.flatMap((row) => rowsByKey.get(legacyRowKey(row)) ?? [row]);
    return { plan, previous, merged: mergeTask(previous, plan, copies) };
  });
  const kept = decorated.filter((row) => row.previous).map((row) => row.merged);
  const fresh = decorated.filter((row) => !row.previous);
  fresh.sort((a, b) => {
    const ao = isTaskOpen(a.merged) ? 0 : 1;
    const bo = isTaskOpen(b.merged) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    if (a.plan.lastDate !== b.plan.lastDate) return b.plan.lastDate.localeCompare(a.plan.lastDate);
    if (a.plan.lastIndex !== b.plan.lastIndex) return a.plan.lastIndex - b.plan.lastIndex;
    return a.merged.id.localeCompare(b.merged.id);
  });
  let prev: string | null = null;
  for (const item of existing.values()) {
    if (item.rank && (prev === null || item.rank > prev)) prev = item.rank;
  }
  const out = kept.slice();
  for (const row of fresh) {
    const rank = rankBetween(prev, null);
    out.push({ ...row.merged, rank });
    prev = rank;
  }
  return { items: out.sort((a, b) => a.id.localeCompare(b.id)), suppressed };
}

function matchExisting(plan: ChainPlan, existing: Map<string, Task>): Task | null {
  const ids = new Set(plan.task.legacyIds ?? [plan.task.id]);
  for (const item of existing.values()) {
    if (ids.has(item.id) || item.legacyIds?.some((id) => ids.has(id))) return item;
  }
  return null;
}

function sampleOf(plan: ChainPlan): ChainSample {
  return {
    text: plan.task.text.slice(0, 80),
    startDate: plan.task.startDate,
    ...(plan.task.endDate ? { endDate: plan.task.endDate } : {}),
    ...(plan.task.endReason ? { endReason: plan.task.endReason } : {}),
    legacyIds: plan.task.legacyIds ?? [plan.task.id],
    days: plan.days,
  };
}

function summarize(
  tasksDir: string,
  rows: LegacyRow[],
  plans: ChainPlan[],
  items: Task[],
  problems: string[],
  unreadable: string[],
  ambiguous: number,
  duplicateRows: number,
  keptDeleted: number,
  dryRun: boolean,
  skipped: boolean,
): MigrationReport {
  const conflicts: MigrationConflict[] = [];
  for (const plan of plans) {
    for (const detail of plan.conflicts) conflicts.push({ id: plan.task.id, text: plan.task.text, detail });
  }
  const ended = plans.filter((plan) => plan.task.endReason === "legacy-moved");
  const collapsed = plans.filter((plan) => plan.rowCount > 1).length;
  const parts: string[] = [];
  if (!skipped && rows.length > 0) parts.push(`Imported ${rows.length} legacy task rows into ${items.length} items (${collapsed} chains collapsed).`);
  if (ended.length > 0) parts.push(`${ended.length} ended by a move with no later copy.`);
  if (unreadable.length > 0) parts.push(`Skipped ${unreadable.length} unreadable legacy file(s).`);
  if (keptDeleted > 0) parts.push(`${keptDeleted} deleted task(s) left deleted.`);
  return {
    tasksDir,
    skipped,
    dryRun,
    legacyFiles: new Set(rows.map((row) => row.source)).size,
    legacyRows: rows.length,
    chains: plans.length,
    collapsed,
    items: items.length,
    open: items.filter((task) => isTaskOpen(task)).length,
    done: items.filter((task) => task.done).length,
    abandoned: items.filter((task) => !!task.abandonedAt && !task.done).length,
    endedByMove: ended.length,
    keptDeleted,
    dropped: droppedRowCount(rows, plans),
    ambiguous,
    duplicateRows,
    conflicts,
    samples: plans.filter((plan) => plan.days.length > 1).sort((a, b) => b.days.length - a.days.length || a.task.text.localeCompare(b.task.text)).slice(0, 10).map(sampleOf),
    endedByMoveSamples: ended.slice(0, 10).map(sampleOf),
    problems,
    unreadable,
    notice: parts.join(" "),
  };
}

export function planLegacyRows(
  tasksDir: string,
  rows: LegacyRow[],
  problems: string[] = [],
  existing: Task[] = [],
  tombstones: Tombstone[] = [],
  unreadable: string[] = [],
): PlannedMigration {
  const { plans, ambiguous, duplicates } = collapseRows(rows);
  const { items, suppressed } = assignRanks(plans, new Map(existing.map((item) => [item.id, item])), tombstones, rows);
  return {
    report: summarize(tasksDir, rows, plans, items, problems, unreadable, ambiguous, duplicates, suppressed.length, true, false),
    items,
    rows,
    suppressed,
  };
}

function filesUnder(dirs: readonly string[]): { file: string; label: string }[] {
  const found: { file: string; label: string }[] = [];
  for (const dir of dirs) {
    for (const file of listLegacyFiles(dir)) found.push({ file, label: `${path.basename(path.dirname(dir))}/${path.basename(dir)}/${path.relative(dir, file)}` });
  }
  return found;
}

/** Read-only plan. `dirs` are unioned, which is a simulated git merge of day files. */
export function planTaskDirs(dirs: readonly string[]): PlannedMigration {
  const files = filesUnder(dirs);
  const loaded = loadLegacyFiles(files.map((entry) => entry.file), (file) => files.find((entry) => entry.file === file)?.label ?? file);
  const existing = dirs.flatMap((dir) => readItems(dir));
  const tombstones = dirs.flatMap((dir) => readTombstones(dir));
  return planLegacyRows(dirs.join(" + "), loaded.rows, loaded.problems, existing, tombstones, loaded.unreadable.map((file) => path.basename(file)));
}

function backupOnce(tasksDir: string, runsDir: string | undefined, state: MigrationState): MigrationState {
  if (state.backedUp) return state;
  const dest = path.join(stateDir(tasksDir), "backup");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(tasksDir, path.join(dest, "tasks"), { recursive: true });
  if (runsDir && fs.existsSync(runsDir)) fs.cpSync(runsDir, path.join(dest, "task-agent-runs"), { recursive: true });
  return { ...state, backedUp: true, backupPath: dest };
}

function moveLegacyFiles(tasksDir: string, keep: ReadonlySet<string>): void {
  const legacyRoot = path.join(tasksDir, "legacy");
  for (const file of listLegacyFiles(tasksDir)) {
    if (keep.has(path.resolve(file))) continue;
    const rel = path.relative(tasksDir, file);
    if (rel === "legacy" || rel.startsWith(`legacy${path.sep}`)) continue;
    const base = path.basename(file);
    let dest = path.join(legacyRoot, base);
    if (fs.existsSync(dest)) {
      if (fs.readFileSync(dest).equals(fs.readFileSync(file))) {
        fs.rmSync(file);
        continue;
      }
      dest = path.join(legacyRoot, "conflicts", `${sha256(fs.readFileSync(file)).slice(0, 12)}-${base}`);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(file, dest);
  }
}

function applyPlan(tasksDir: string, planned: Task[], existing: Task[], suppressed: ChainPlan[]): void {
  const suppressedIds = new Set<string>();
  for (const plan of suppressed) {
    suppressedIds.add(plan.task.id);
    for (const id of plan.task.legacyIds ?? []) suppressedIds.add(id);
  }
  for (const previous of existing) {
    if (suppressedIds.has(previous.id) || previous.legacyIds?.some((id) => suppressedIds.has(id))) removeItem(tasksDir, previous.id);
  }
  const surviving = new Set(planned.map((task) => task.id));
  for (const previous of existing) {
    if (surviving.has(previous.id)) continue;
    const absorbed = planned.some((task) => task.legacyIds?.includes(previous.id) || previous.legacyIds?.some((id) => task.legacyIds?.includes(id) || id === task.id));
    if (absorbed) removeItem(tasksDir, previous.id);
  }
  for (const task of planned) writeItem(tasksDir, task);
}

function writeReport(tasksDir: string, report: MigrationReport): void {
  const lines = [
    "# Task migration",
    "",
    report.notice || "No legacy day files.",
    "",
    `- legacy files: ${report.legacyFiles}`,
    `- legacy rows: ${report.legacyRows}`,
    `- chains: ${report.chains}`,
    `- collapsed: ${report.collapsed}`,
    `- items: ${report.items} (open ${report.open}, done ${report.done}, abandoned ${report.abandoned}, ended by move ${report.endedByMove})`,
    `- kept deleted: ${report.keptDeleted}`,
    `- duplicate rows folded: ${report.duplicateRows}`,
    `- dropped: ${report.dropped}`,
    `- conflicts: ${report.conflicts.length}`,
    `- unreadable: ${report.unreadable.length}`,
    "",
  ];
  for (const conflict of report.conflicts) lines.push(`- conflict ${conflict.id}: ${conflict.detail}`);
  for (const file of report.unreadable) lines.push(`- unreadable: ${file}`);
  for (const sample of report.endedByMoveSamples) lines.push(`- ended by move: ${sample.text} (${sample.startDate} -> ${sample.endDate ?? ""})`);
  fs.mkdirSync(stateDir(tasksDir), { recursive: true });
  fs.writeFileSync(path.join(stateDir(tasksDir), "report.md"), `${lines.join("\n")}\n`);
}

function migrateLocked(tasksDir: string, opts: { runsDir?: string }): MigrationReport {
  fs.mkdirSync(tasksDir, { recursive: true });
  const files = listLegacyFiles(tasksDir);
  const fingerprint = fingerprintFiles(tasksDir, files);
  const state = readState(tasksDir);
  if (state?.fingerprint === fingerprint) {
    const skipped = summarize(tasksDir, [], [], readItems(tasksDir), [], [], 0, 0, 0, false, true);
    return { ...skipped, notice: migrationNoticeFor(tasksDir) };
  }
  invalidateTaskCache(tasksDir);
  const loaded = loadLegacyFiles(files, (file) => path.relative(tasksDir, file));
  const existing = readItems(tasksDir);
  const planned = planLegacyRows(
    tasksDir,
    loaded.rows,
    loaded.problems,
    existing,
    readTombstones(tasksDir),
    loaded.unreadable.map((file) => path.relative(tasksDir, file)),
  );
  if (planned.report.dropped > 0) {
    const notice = `Left legacy files in place: ${planned.report.dropped} rows were not mapped.`;
    rememberNotice(tasksDir, notice);
    console.info(notice);
    return { ...planned.report, dryRun: false, skipped: true, notice };
  }
  if (loaded.rows.length === 0) {
    writeState(tasksDir, { ...(state ?? { fingerprint }), fingerprint });
    const notice = planned.report.notice || migrationNoticeFor(tasksDir);
    rememberNotice(tasksDir, notice);
    if (planned.report.notice) console.info(planned.report.notice);
    return { ...planned.report, dryRun: false, skipped: true, notice };
  }
  const backed = backupOnce(tasksDir, opts.runsDir, state ?? { fingerprint });
  applyPlan(tasksDir, planned.items, existing, planned.suppressed);
  moveLegacyFiles(tasksDir, new Set(loaded.unreadable.map((file) => path.resolve(file))));
  if (opts.runsDir) relinkMigratedRuns(opts.runsDir, planned.items.map((task) => ({ id: task.id, legacyIds: task.legacyIds })));
  writeState(tasksDir, { ...backed, fingerprint: fingerprintFiles(tasksDir, listLegacyFiles(tasksDir)) });
  writeReport(tasksDir, planned.report);
  invalidateTaskCache(tasksDir);
  rememberNotice(tasksDir, planned.report.notice);
  if (planned.report.notice) console.info(planned.report.notice);
  return { ...planned.report, dryRun: false, skipped: false };
}

function failedReport(tasksDir: string, err: unknown, dryRun: boolean): MigrationReport {
  const message = err instanceof Error ? err.message : String(err);
  const notice = `Task migration did not run: ${message}. Existing tasks are untouched; it will retry on next access.`;
  rememberNotice(tasksDir, notice);
  console.warn(notice);
  return { ...summarize(tasksDir, [], [], [], [message], [], 0, 0, 0, dryRun, true), notice };
}

/** Never rejects: a failure becomes a skipped report with a notice, so callers on the request path keep serving. */
export function migrateDirectory(tasksDir: string, opts: { runsDir?: string; dryRun?: boolean } = {}): Promise<MigrationReport> {
  if (opts.dryRun) {
    try {
      const files = listLegacyFiles(tasksDir);
      const loaded = loadLegacyFiles(files, (file) => path.relative(tasksDir, file));
      return Promise.resolve(planLegacyRows(tasksDir, loaded.rows, loaded.problems, readItems(tasksDir), readTombstones(tasksDir), loaded.unreadable.map((file) => path.relative(tasksDir, file))).report);
    } catch (err) {
      return Promise.resolve(failedReport(tasksDir, err, true));
    }
  }
  const key = path.resolve(tasksDir);
  const pending = migrations.get(key);
  if (pending) return pending;
  const run = (async () => {
    try {
      await acquireLock(tasksDir);
      try {
        return migrateLocked(tasksDir, opts);
      } finally {
        releaseLock(tasksDir);
      }
    } catch (err) {
      return failedReport(tasksDir, err, false);
    }
  })();
  migrations.set(key, run);
  void run.finally(() => {
    if (migrations.get(key) === run) migrations.delete(key);
  });
  return run;
}

export function migrateTasksRoot(tasksRoot: string, opts: { runsDir?: string } = {}): Promise<MigrationReport> {
  const key = path.resolve(tasksRoot);
  const pending = rootMigrations.get(key);
  if (pending) return pending;
  const run = (async () => {
    let reports: MigrationReport[];
    try {
      fs.mkdirSync(tasksRoot, { recursive: true });
      reports = [await migrateDirectory(tasksRoot, opts)];
      for (const id of listTaskProfiles(tasksRoot)) reports.push(await migrateDirectory(path.join(tasksRoot, id), opts));
    } catch (err) {
      return failedReport(tasksRoot, err, false);
    }
    const active = reports.find((report) => report.notice) ?? reports[0]!;
    const sum = (pick: (report: MigrationReport) => number) => reports.reduce((total, report) => total + pick(report), 0);
    const combined: MigrationReport = {
      ...active,
      legacyFiles: sum((report) => report.legacyFiles),
      legacyRows: sum((report) => report.legacyRows),
      chains: sum((report) => report.chains),
      collapsed: sum((report) => report.collapsed),
      items: sum((report) => (report.skipped ? 0 : report.items)),
      open: sum((report) => (report.skipped ? 0 : report.open)),
      done: sum((report) => (report.skipped ? 0 : report.done)),
      abandoned: sum((report) => (report.skipped ? 0 : report.abandoned)),
      endedByMove: sum((report) => report.endedByMove),
      keptDeleted: sum((report) => report.keptDeleted),
      dropped: sum((report) => report.dropped),
      ambiguous: sum((report) => report.ambiguous),
      duplicateRows: sum((report) => report.duplicateRows),
      conflicts: reports.flatMap((report) => report.conflicts),
      samples: reports.flatMap((report) => report.samples).slice(0, 10),
      endedByMoveSamples: reports.flatMap((report) => report.endedByMoveSamples).slice(0, 10),
      problems: reports.flatMap((report) => report.problems),
      unreadable: reports.flatMap((report) => report.unreadable),
      notice: reports.map((report) => report.notice).filter(Boolean).join(" "),
      skipped: reports.every((report) => report.skipped),
    };
    rememberNotice(tasksRoot, combined.notice);
    return combined;
  })();
  rootMigrations.set(key, run);
  void run.finally(() => {
    if (rootMigrations.get(key) === run) rootMigrations.delete(key);
  });
  return run;
}

/** Forget the fingerprint so the next migrate rebuilds from the legacy files. */
export function clearMigrationState(tasksDir: string): void {
  fs.rmSync(stateDir(tasksDir), { recursive: true, force: true });
}
