import type { EntityRef } from "../entity-note/index.ts";
import { sha256 } from "./paths.ts";
import type { Task, TaskStage } from "./types.ts";

export interface LegacyTask {
  id: string;
  text: string;
  done: boolean;
  createdAt?: string;
  completedAt?: string;
  abandonedAt?: string;
  abandonReason?: string;
  movedAt?: string;
  movedToDate?: string;
  rolledFromId?: string;
  rolledFromDate?: string;
  jiraKey?: string;
  due?: string;
  timeSpentMs?: number;
  notePath?: string;
  links?: EntityRef[];
  stage?: TaskStage;
  /** Keys this version does not model. Copied onto the surviving item. */
  extra?: Record<string, unknown>;
}

export interface LegacyRow {
  date: string;
  index: number;
  source: string;
  task: LegacyTask;
}

export interface ChainPlan {
  task: Task;
  days: string[];
  rowCount: number;
  conflicts: string[];
  lastDate: string;
  lastIndex: number;
  rows: LegacyRow[];
}

const KNOWN_LEGACY_KEYS = new Set([
  "id",
  "text",
  "done",
  "createdAt",
  "completedAt",
  "abandonedAt",
  "abandonReason",
  "movedAt",
  "movedToDate",
  "rolledFromId",
  "rolledFromDate",
  "jiraKey",
  "due",
  "timeSpentMs",
  "notePath",
  "links",
  "stage",
  "timerStartedAt",
]);

function isLegacyOpen(task: LegacyTask): boolean {
  return task.done !== true && !task.abandonedAt && !task.movedAt;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asLinks(value: unknown): EntityRef[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const links: EntityRef[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const source = entry as Record<string, unknown>;
    if (typeof source.kind !== "string" || typeof source.id !== "string" || typeof source.label !== "string") continue;
    const link: Record<string, unknown> = { kind: source.kind, id: source.id, label: source.label };
    if (typeof source.href === "string" && source.href) link.href = source.href;
    if (typeof source.marker === "string" && source.marker) link.marker = source.marker;
    for (const key of Object.keys(source).sort()) {
      if (key === "kind" || key === "id" || key === "label" || key === "href" || key === "marker") continue;
      if (source[key] !== undefined) link[key] = source[key];
    }
    links.push(link as unknown as EntityRef);
  }
  return links.length > 0 ? links : undefined;
}

export function parseLegacyTask(raw: unknown, date: string, index: number): LegacyTask | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const text = asString(row.text) ?? "";
  let id = asString(row.id);
  if (!id) id = `legacy-${sha256(`${date}|${index}|${text}`).slice(0, 32)}`;
  const stage = row.stage === "draft" ? "draft" : undefined;
  const time = typeof row.timeSpentMs === "number" && Number.isFinite(row.timeSpentMs) ? row.timeSpentMs : undefined;
  const extra: Record<string, unknown> = {};
  for (const key of Object.keys(row).sort()) {
    if (KNOWN_LEGACY_KEYS.has(key) || row[key] === undefined) continue;
    extra[key] = row[key];
  }
  return {
    id,
    text,
    done: row.done === true,
    createdAt: asString(row.createdAt),
    completedAt: asString(row.completedAt),
    abandonedAt: asString(row.abandonedAt),
    abandonReason: asString(row.abandonReason),
    movedAt: asString(row.movedAt),
    movedToDate: asString(row.movedToDate),
    rolledFromId: asString(row.rolledFromId),
    rolledFromDate: asString(row.rolledFromDate),
    jiraKey: asString(row.jiraKey),
    due: asString(row.due),
    timeSpentMs: time,
    notePath: asString(row.notePath),
    links: asLinks(row.links),
    stage,
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}

export function rowsFromJson(raw: unknown, date: string, source: string, problems: string[]): LegacyRow[] {
  if (!Array.isArray(raw)) {
    problems.push(`${source}: not a task array`);
    return [];
  }
  const rows: LegacyRow[] = [];
  raw.forEach((entry, index) => {
    const task = parseLegacyTask(entry, date, index);
    if (!task) {
      problems.push(`${source}[${index}]: unreadable row`);
      return;
    }
    rows.push({ date, index, source, task });
  });
  return rows;
}

function find(parent: number[], index: number): number {
  let cursor = index;
  while (parent[cursor] !== cursor) {
    parent[cursor] = parent[parent[cursor]!]!;
    cursor = parent[cursor]!;
  }
  return cursor;
}

function union(parent: number[], a: number, b: number): void {
  const pa = find(parent, a);
  const pb = find(parent, b);
  if (pa !== pb) parent[pb] = pa;
}

function pickTextLink(rows: LegacyRow[], source: number, hits: number[]): number | null {
  const others = hits.filter((index) => index !== source);
  if (others.length === 0) return null;
  const sourceId = rows[source]!.task.id;
  const same = others.find((index) => rows[index]!.task.id === sourceId);
  if (same !== undefined) return same;
  const rolled = others.find((index) => rows[index]!.task.rolledFromId === sourceId);
  if (rolled !== undefined) return rolled;
  if (others.length === 1) return others[0]!;
  return null;
}

function latest(rows: LegacyRow[]): LegacyRow {
  return [...rows].sort((a, b) => b.date.localeCompare(a.date) || b.index - a.index)[0]!;
}

function earliestBy(rows: LegacyRow[], stamp: (row: LegacyRow) => string): LegacyRow {
  return [...rows].sort((a, b) => stamp(a).localeCompare(stamp(b)) || a.date.localeCompare(b.date) || a.index - b.index)[0]!;
}

function planChain(rows: LegacyRow[]): ChainPlan {
  const startDate = rows.reduce((min, row) => (row.date < min ? row.date : min), rows[0]!.date);
  const lastDate = rows.reduce((max, row) => (row.date > max ? row.date : max), rows[0]!.date);
  const lastIndex = rows.filter((row) => row.date === lastDate).reduce((min, row) => Math.min(min, row.index), Number.POSITIVE_INFINITY);
  const onEarliest = rows.filter((row) => row.date === startDate).map((row) => row.task.id).sort();
  const id = onEarliest[0]!;
  const legacyIds = [...new Set(rows.flatMap((row) => [row.task.id, row.task.rolledFromId].filter((value): value is string => !!value)))].sort();

  const doneRows = rows.filter((row) => row.task.done);
  const abandonedRows = rows.filter((row) => !!row.task.abandonedAt);
  const openRows = rows.filter((row) => isLegacyOpen(row.task));
  const winner = doneRows.length > 0 ? "done" : abandonedRows.length > 0 ? "abandoned" : openRows.length > 0 ? "open" : "moved";
  const fieldPool = winner === "done" ? doneRows : winner === "abandoned" ? abandonedRows : winner === "open" ? openRows : rows;
  const fields = latest(fieldPool);
  const conflicts: string[] = [];

  let endDate: string | undefined;
  let endReason: Task["endReason"];
  let completedAt: string | undefined;
  let abandonedAt: string | undefined;
  let abandonReason: string | undefined;
  if (winner === "done") {
    const earliest = earliestBy(doneRows, (row) => row.task.completedAt ?? `${row.date}T23:59:59.999Z`);
    completedAt = earliest.task.completedAt ?? `${earliest.date}T00:00:00.000Z`;
    // File day, not the UTC date of the timestamp. A completion just after local midnight is still that file's day.
    endDate = earliest.date;
    for (const row of rows) {
      if (!row.task.done && row.date > endDate) {
        conflicts.push(`done on ${endDate} kept over ${row.task.abandonedAt ? "abandoned" : "open"} snapshot on ${row.date} (${row.task.text.trim().slice(0, 80)})`);
      }
    }
    if (abandonedRows.length > 0) conflicts.push(`done on ${endDate} kept over an abandoned snapshot`);
  } else if (winner === "abandoned") {
    const earliest = earliestBy(abandonedRows, (row) => row.task.abandonedAt ?? `${row.date}T23:59:59.999Z`);
    abandonedAt = earliest.task.abandonedAt ?? `${earliest.date}T00:00:00.000Z`;
    abandonReason = earliest.task.abandonReason;
    endDate = earliest.date;
    for (const row of rows) {
      if (isLegacyOpen(row.task) && row.date > endDate) {
        conflicts.push(`abandoned on ${endDate} kept over open snapshot on ${row.date} (${row.task.text.trim().slice(0, 80)})`);
      }
    }
  } else if (winner === "moved") {
    endDate = lastDate;
    endReason = "legacy-moved";
  }

  const notePath = fields.task.notePath ?? [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index).find((row) => row.task.notePath)?.task.notePath;
  const linkSource = fields.task.links ?? [...rows].sort((a, b) => b.date.localeCompare(a.date) || b.index - a.index).find((row) => row.task.links?.length)?.task.links;
  const times = rows.map((row) => row.task.timeSpentMs).filter((value): value is number => typeof value === "number");
  const createdAt = rows.map((row) => row.task.createdAt).filter((value): value is string => !!value).sort()[0] ?? `${startDate}T00:00:00.000Z`;
  const due = fields.task.due ?? rows.find((row) => row.task.due)?.task.due;

  const task: Task = {
    ...(fields.task.extra ?? {}),
    id,
    text: fields.task.text,
    done: winner === "done",
    startDate,
    rank: "",
    legacyThrough: lastDate,
    createdAt,
    legacyIds,
    ...(endDate ? { endDate } : {}),
    ...(endReason ? { endReason } : {}),
    ...(fields.task.jiraKey ? { jiraKey: fields.task.jiraKey } : {}),
    ...(due ? { due } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(abandonedAt ? { abandonedAt } : {}),
    ...(abandonReason ? { abandonReason } : {}),
    ...(times.length > 0 ? { timeSpentMs: Math.max(...times) } : {}),
    ...(notePath ? { notePath } : {}),
    ...(linkSource ? { links: linkSource } : {}),
    ...(fields.task.stage ? { stage: fields.task.stage } : {}),
  };

  return {
    task,
    days: [...new Set(rows.map((row) => row.date))].sort(),
    rowCount: rows.length,
    conflicts: [...new Set(conflicts)],
    lastDate,
    lastIndex,
    rows,
  };
}

export interface CollapseResult {
  plans: ChainPlan[];
  ambiguous: number;
  /** Rows folded into an identical (date, id) row from another copy of the same day file. */
  duplicates: number;
  problems: string[];
}

function closureRank(task: LegacyTask): number {
  if (task.done) return 3;
  if (task.abandonedAt) return 2;
  return isLegacyOpen(task) ? 1 : 0;
}

function stampOf(task: LegacyTask): string {
  return task.done ? (task.completedAt ?? "") : (task.abandonedAt ?? "");
}

/** Deterministic tie-break that does not depend on file order or which machine read it first. */
function rowFingerprint(row: LegacyRow): string {
  return JSON.stringify([row.task, row.source]);
}

function betterRow(a: LegacyRow, b: LegacyRow): LegacyRow {
  const rank = closureRank(a.task) - closureRank(b.task);
  if (rank !== 0) return rank > 0 ? a : b;
  // Same closure: the earliest completion/abandon stamp wins. A missing stamp loses to a real one.
  const sa = stampOf(a.task);
  const sb = stampOf(b.task);
  if (sa !== sb && sa && sb) return sa < sb ? a : b;
  if (sa !== sb) return sa ? a : b;
  return rowFingerprint(a) <= rowFingerprint(b) ? a : b;
}

function mergeDuplicate(winner: LegacyRow, others: LegacyRow[]): LegacyRow {
  const task: LegacyTask = { ...winner.task };
  const all = [winner, ...others];
  for (const key of ["jiraKey", "due", "notePath", "links", "createdAt"] as const) {
    if (key === "createdAt") {
      const earliest = all.map((row) => row.task.createdAt).filter((v): v is string => !!v).sort()[0];
      if (earliest) task.createdAt = earliest;
      continue;
    }
    if (task[key] === undefined) {
      const donor = [...all].sort((x, y) => rowFingerprint(x).localeCompare(rowFingerprint(y))).find((row) => row.task[key] !== undefined);
      if (donor) (task as unknown as Record<string, unknown>)[key] = donor.task[key];
    }
  }
  const times = all.map((row) => row.task.timeSpentMs).filter((v): v is number => typeof v === "number");
  if (times.length > 0) task.timeSpentMs = Math.max(...times);
  return { date: winner.date, index: Math.min(...all.map((row) => row.index)), source: winner.source, task };
}

/**
 * Identical day files meeting from two machines, `legacy/` + root copies and
 * `legacy/conflicts/` copies all repeat the same (date, id). Fold them into one
 * row so they cannot look like a second task, or an ambiguous text match.
 */
export function dedupeRows(rows: LegacyRow[]): { rows: LegacyRow[]; duplicates: number } {
  const groups = new Map<string, LegacyRow[]>();
  for (const row of rows) {
    const key = `${row.date}\0${row.task.id}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const out: LegacyRow[] = [];
  let duplicates = 0;
  for (const list of groups.values()) {
    if (list.length === 1) {
      out.push(list[0]!);
      continue;
    }
    duplicates += list.length - 1;
    const winner = list.reduce(betterRow);
    out.push(mergeDuplicate(winner, list.filter((row) => row !== winner)));
  }
  return { rows: out, duplicates };
}

/** Collapse legacy rows into one plan per chain. Pure: no clock, no randomness. */
export function collapseRows(input: LegacyRow[]): CollapseResult {
  const deduped = dedupeRows(input);
  const rows = deduped.rows.sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index || a.task.id.localeCompare(b.task.id));
  const parent = rows.map((_, index) => index);
  const byId = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const list = byId.get(row.task.id) ?? [];
    list.push(index);
    byId.set(row.task.id, list);
  });
  for (const indexes of byId.values()) {
    for (let i = 1; i < indexes.length; i += 1) union(parent, indexes[0]!, indexes[i]!);
  }
  const byRolled = new Map<string, number[]>();
  rows.forEach((row, index) => {
    if (!row.task.rolledFromId) return;
    const list = byRolled.get(row.task.rolledFromId) ?? [];
    list.push(index);
    byRolled.set(row.task.rolledFromId, list);
    for (const target of byId.get(row.task.rolledFromId) ?? []) union(parent, index, target);
  });
  for (const indexes of byRolled.values()) {
    for (let i = 1; i < indexes.length; i += 1) union(parent, indexes[0]!, indexes[i]!);
  }

  const byDateText = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const key = `${row.date}\0${row.task.text.trim()}`;
    const list = byDateText.get(key) ?? [];
    list.push(index);
    byDateText.set(key, list);
  });

  let ambiguous = 0;
  const linkHits = (index: number, hits: number[]) => {
    const chosen = pickTextLink(rows, index, hits);
    if (chosen === null && hits.filter((hit) => hit !== index).length > 1) ambiguous += 1;
    if (chosen !== null) union(parent, index, chosen);
  };

  rows.forEach((row, index) => {
    if (!row.task.movedToDate) return;
    linkHits(index, byDateText.get(`${row.task.movedToDate}\0${row.task.text.trim()}`) ?? []);
  });

  const sortedDates = [...new Set(rows.map((row) => row.date))].sort();
  const nextExisting = new Map<string, string>();
  for (let i = 0; i < sortedDates.length - 1; i += 1) nextExisting.set(sortedDates[i]!, sortedDates[i + 1]!);
  rows.forEach((row, index) => {
    if (!isLegacyOpen(row.task)) return;
    const next = nextExisting.get(row.date);
    if (!next) return;
    linkHits(index, byDateText.get(`${next}\0${row.task.text.trim()}`) ?? []);
  });

  const groups = new Map<number, LegacyRow[]>();
  rows.forEach((row, index) => {
    const root = find(parent, index);
    const list = groups.get(root) ?? [];
    list.push(row);
    groups.set(root, list);
  });

  const plans = [...groups.values()].map(planChain).sort((a, b) => a.task.id.localeCompare(b.task.id));
  return { plans, ambiguous, duplicates: deduped.duplicates, problems: [] };
}

export function droppedRowCount(rows: LegacyRow[], plans: ChainPlan[]): number {
  const owners = new Map<string, Set<string>>();
  for (const plan of plans) {
    for (const id of plan.task.legacyIds ?? [plan.task.id]) {
      const set = owners.get(id) ?? new Set<string>();
      set.add(plan.task.id);
      owners.set(id, set);
    }
  }
  return rows.filter((row) => (owners.get(row.task.id)?.size ?? 0) !== 1).length;
}
