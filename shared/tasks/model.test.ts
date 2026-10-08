import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collapseRows, rowsFromJson } from "./chains.ts";
import { todayISO } from "./dates.ts";
import { clearMigrationState, migrateDirectory, migrateTasksRoot, planTaskDirs } from "./migrate.ts";
import { serializeTask } from "./json.ts";
import { sha256 } from "./paths.ts";
import { itemPath } from "./paths.ts";
import { changedRanks } from "./rank.ts";
import {
  createTask,
  deleteTask,
  deletedDir,
  findTask,
  invalidateTaskCache,
  itemReadErrors,
  patchTask,
  readItems,
  reorderOpenTasks,
  startTimer,
  stopTimer,
  tasksOnDay,
  writeItem,
} from "./store.ts";
import type { Task } from "./types.ts";
import { isTaskOpen } from "./types.ts";
import { isVisibleOn, projectTask, slipDays } from "./view.ts";

const dirs: string[] = [];

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function dayFile(dir: string, date: string, tasks: unknown[], name = `${date}.json`): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), `${JSON.stringify(tasks, null, 2)}\n`);
}

function row(id: string, text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, text, done: false, createdAt: "2026-09-01T00:00:00.000Z", ...extra };
}

function plan(rows: { date: string; tasks: unknown[] }[]) {
  const legacy = rows.flatMap((day) => rowsFromJson(day.tasks, day.date, day.date, []));
  return collapseRows(legacy).plans;
}

function itemBytes(dir: string): Record<string, string> {
  const root = path.join(dir, "items");
  const out: Record<string, string> = {};
  if (!fs.existsSync(root)) return out;
  for (const name of fs.readdirSync(root).sort()) {
    if (name.endsWith(".json")) out[name] = fs.readFileSync(path.join(root, name), "utf8");
  }
  return out;
}

describe("chain collapsing", () => {
  it("keeps one item for the same id, including an interrupted rollover", () => {
    const plans = plan([
      { date: "2026-09-01", tasks: [row("same", "Ship it")] },
      { date: "2026-09-02", tasks: [row("same", "Ship it", { movedAt: "2026-09-02T01:00:00.000Z", movedToDate: "2026-09-03" })] },
      { date: "2026-09-03", tasks: [row("same", "Ship it today")] },
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.task.id).toBe("same");
    expect(plans[0]!.task.startDate).toBe("2026-09-01");
    expect(plans[0]!.task.text).toBe("Ship it today");
    expect(isTaskOpen(plans[0]!.task)).toBe(true);
    expect(plans[0]!.task.legacyIds).toEqual(["same"]);
  });

  it("follows rolledFromId and keeps the earliest id", () => {
    const plans = plan([
      { date: "2026-09-01", tasks: [row("OLD", "Carry")] },
      { date: "2026-09-02", tasks: [row("NEW", "Carry", { rolledFromId: "OLD", rolledFromDate: "2026-09-01" })] },
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.task.id).toBe("OLD");
    expect(plans[0]!.task.legacyIds).toEqual(["NEW", "OLD"]);
  });

  it("records a rolledFromId even when that row is missing", () => {
    const plans = plan([
      { date: "2026-09-02", tasks: [row("NEW", "Carry", { rolledFromId: "MISSING" })] },
    ]);
    expect(plans[0]!.task.legacyIds).toContain("MISSING");
  });

  it("links movedToDate plus the same trimmed text", () => {
    const plans = plan([
      { date: "2026-09-01", tasks: [row("a", "  Same  ", { movedAt: "2026-09-02T00:00:00.000Z", movedToDate: "2026-09-02" })] },
      { date: "2026-09-02", tasks: [row("b", "Same")] },
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.task.id).toBe("a");
    expect(plans[0]!.task.legacyIds).toEqual(["a", "b"]);
  });

  it("collapses the same open text across a weekend when no day file sits in between", () => {
    const plans = plan([
      { date: "2026-10-02", tasks: [row("fri", "Same")] },
      { date: "2026-10-05", tasks: [row("mon", "Same")] },
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.task.id).toBe("fri");
  });

  it("keeps the same text separate when an intervening day file does not contain it", () => {
    const plans = plan([
      { date: "2026-10-02", tasks: [row("fri", "Same")] },
      { date: "2026-10-03", tasks: [row("sat", "Other")] },
      { date: "2026-10-05", tasks: [row("mon", "Same")] },
    ]);
    expect(plans.map((item) => item.task.id).sort()).toEqual(["fri", "mon", "sat"]);
  });

  it("merges an open task into the next calendar day when the text matches", () => {
    const plans = plan([
      { date: "2026-09-01", tasks: [row("a", "Same")] },
      { date: "2026-09-02", tasks: [row("b", "Same")] },
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.task.id).toBe("a");
  });

  it("leaves ambiguous text matches unlinked", () => {
    const rows = [
      ...rowsFromJson([row("a", "Same")], "2026-09-01", "d1", []),
      ...rowsFromJson([row("b", "Same"), row("c", "Same")], "2026-09-02", "d2", []),
    ];
    const result = collapseRows(rows);
    expect(result.plans).toHaveLength(3);
    expect(result.ambiguous).toBe(1);
  });

  it("lets done beat a later open snapshot and keeps the earliest completion", () => {
    const plans = plan([
      { date: "2026-09-01", tasks: [row("a", "Done first", { done: true, completedAt: "2026-09-01T08:00:00.000Z" })] },
      { date: "2026-09-02", tasks: [row("a", "Done later", { done: true, completedAt: "2026-09-02T08:00:00.000Z" })] },
      { date: "2026-09-03", tasks: [row("a", "Reopened")] },
    ]);
    expect(plans[0]!.task.done).toBe(true);
    expect(plans[0]!.task.completedAt).toBe("2026-09-01T08:00:00.000Z");
    expect(plans[0]!.task.endDate).toBe("2026-09-01");
    expect(plans[0]!.task.text).toBe("Done later");
    expect(plans[0]!.conflicts.length).toBeGreaterThan(0);
  });

  it("lets abandoned beat open and keeps the earliest abandon", () => {
    const plans = plan([
      { date: "2026-09-02", tasks: [row("a", "Later", { abandonedAt: "2026-09-02T09:00:00.000Z", abandonReason: "later" })] },
      { date: "2026-09-01", tasks: [row("a", "Earlier", { abandonedAt: "2026-09-01T09:00:00.000Z", abandonReason: "earlier" })] },
      { date: "2026-09-03", tasks: [row("a", "Open again")] },
    ]);
    expect(plans[0]!.task.abandonedAt).toBe("2026-09-01T09:00:00.000Z");
    expect(plans[0]!.task.endDate).toBe("2026-09-01");
    expect(isTaskOpen(plans[0]!.task)).toBe(false);
  });

  it("closes a moved-only chain without calling it done", () => {
    const plans = plan([
      { date: "2026-09-01", tasks: [row("a", "Gone", { movedAt: "2026-09-01T12:00:00.000Z", movedToDate: "2026-09-02" })] },
    ]);
    expect(plans[0]!.task.done).toBe(false);
    expect(plans[0]!.task.abandonedAt).toBeUndefined();
    expect(plans[0]!.task.endDate).toBe("2026-09-01");
    expect(plans[0]!.task.endReason).toBe("legacy-moved");
    expect(isTaskOpen(plans[0]!.task)).toBe(false);
  });

  it("reopens a moved-only chain when a later open continuation arrives", () => {
    const plans = plan([
      { date: "2026-09-01", tasks: [row("a", "Gone", { movedAt: "2026-09-01T12:00:00.000Z" })] },
      { date: "2026-09-02", tasks: [row("a", "Back")] },
    ]);
    expect(isTaskOpen(plans[0]!.task)).toBe(true);
    expect(plans[0]!.task.text).toBe("Back");
  });

  it("keeps the max time and the earliest note path", () => {
    const plans = plan([
      { date: "2026-09-01", tasks: [row("a", "T", { timeSpentMs: 10, notePath: "task-notes/2026-09-01-a" })] },
      { date: "2026-09-02", tasks: [row("a", "T", { timeSpentMs: 40 })] },
    ]);
    expect(plans[0]!.task.timeSpentMs).toBe(40);
    expect(plans[0]!.task.notePath).toBe("task-notes/2026-09-01-a");
  });
});

describe("migration", () => {
  it("is idempotent, deterministic across directories, and keeps a one-time backup", async () => {
    const seed = (dir: string) => {
      dayFile(dir, "2026-09-01", [row("OLD", "Alpha", { timeSpentMs: 5 })]);
      dayFile(dir, "2026-09-02", [row("NEW", "Alpha", { rolledFromId: "OLD", timeSpentMs: 9 })]);
      dayFile(dir, "2026-09-03", [row("b", "Beta")]);
    };
    const left = tmp("tasks-left-");
    const right = tmp("tasks-right-");
    seed(left);
    seed(right);
    const runs = tmp("tasks-runs-");
    fs.writeFileSync(path.join(runs, "NEW.json"), `${JSON.stringify({ version: 1, taskId: "NEW", handoff: "from z", runs: [{ runId: "r1", updatedAt: "2026-09-01T00:00:00.000Z" }] })}\n`);
    fs.writeFileSync(path.join(runs, "_index.json"), `${JSON.stringify({ version: 1, byRunId: { r1: "NEW" } })}\n`);

    const first = await migrateDirectory(left, { runsDir: runs });
    expect(first.dropped).toBe(0);
    expect(first.items).toBe(2);
    const bytes = itemBytes(left);
    expect((await migrateDirectory(left, { runsDir: runs })).skipped).toBe(true);
    expect(itemBytes(left)).toEqual(bytes);
    clearMigrationState(left);
    await migrateDirectory(left, { runsDir: runs });
    expect(itemBytes(left)).toEqual(bytes);

    await migrateDirectory(right);
    expect(itemBytes(right)).toEqual(bytes);
    expect(fs.existsSync(path.join(left, "2026-09-01.json"))).toBe(false);
    expect(fs.existsSync(path.join(left, "legacy", "2026-09-01.json"))).toBe(true);
    const home = process.env.DEVHUB_TASK_MIGRATION_DIR;
    expect(home).toBeUndefined();
    const migrated = readItems(left);
    expect(migrated.find((task) => task.id === "OLD")?.timeSpentMs).toBe(9);
    expect(fs.readFileSync(path.join(runs, "OLD.json"), "utf8")).toContain("from z");
    expect(fs.existsSync(path.join(runs, "NEW.json"))).toBe(false);
    const index = JSON.parse(fs.readFileSync(path.join(runs, "_index.json"), "utf8")) as { byRunId: Record<string, string> };
    expect(index.byRunId.r1).toBe("OLD");
  });

  it("imports a late day file without duplicating or reopening a finished task", async () => {
    const dir = tmp("tasks-late-");
    dayFile(dir, "2026-09-01", [row("a", "Alpha")]);
    await migrateDirectory(dir);
    const edited = findTask(dir, "a")!;
    writeItem(dir, { ...edited, text: "user edit" });
    clearMigrationState(dir);
    await migrateDirectory(dir);
    expect(findTask(dir, "a")?.text).toBe("user edit");

    dayFile(dir, "2026-09-02", [row("a", "from the other machine"), row("c", "Brand new")]);
    const cont = await migrateDirectory(dir);
    expect(cont.dropped).toBe(0);
    expect(findTask(dir, "a")?.text).toBe("from the other machine");
    expect(findTask(dir, "c")?.text).toBe("Brand new");
    expect(readItems(dir)).toHaveLength(2);

    const keptRank = findTask(dir, "a")!.rank;
    dayFile(dir, "2026-09-03", [row("a", "closed over there", { done: true, completedAt: "2026-09-03T10:00:00.000Z" })]);
    await migrateDirectory(dir);
    const done = findTask(dir, "a")!;
    expect(done.done).toBe(true);
    expect(done.endDate).toBe("2026-09-03");
    expect(done.rank).toBe(keptRank);
    dayFile(dir, "2026-09-04", [row("a", "stale open")]);
    await migrateDirectory(dir);
    expect(findTask(dir, "a")?.done).toBe(true);
    expect(findTask(dir, "a")?.text).not.toBe("stale open");
  });

  it("merges a .local.json overlay and a conflicting copy", async () => {
    const dir = tmp("tasks-local-");
    dayFile(dir, "2026-09-24", [row("a", "Open")]);
    dayFile(dir, "2026-09-24", [row("a", "Closed", { done: true, completedAt: "2026-09-24T12:00:00.000Z" })], "2026-09-24.local.json");
    await migrateDirectory(dir);
    expect(findTask(dir, "a")?.done).toBe(true);

    const again = tmp("tasks-conflict-");
    fs.mkdirSync(path.join(again, "legacy"), { recursive: true });
    fs.writeFileSync(path.join(again, "legacy", "2026-09-24.json"), `${JSON.stringify([row("a", "Open")], null, 2)}\n`);
    dayFile(again, "2026-09-24", [row("a", "Closed", { done: true, completedAt: "2026-09-24T12:00:00.000Z" })]);
    await migrateDirectory(again);
    expect(findTask(again, "a")?.done).toBe(true);
    const conflicts = fs.readdirSync(path.join(again, "legacy", "conflicts"));
    expect(conflicts.some((name) => name.endsWith("-2026-09-24.json"))).toBe(true);
  });

  it("migrates each profile on its own", async () => {
    const root = tmp("tasks-profiles-");
    dayFile(root, "2026-09-01", [row("home", "Home")]);
    dayFile(path.join(root, "work"), "2026-09-01", [row("job", "Job")]);
    const report = await migrateTasksRoot(root);
    expect(report.dropped).toBe(0);
    expect(findTask(root, "home")?.text).toBe("Home");
    expect(findTask(path.join(root, "work"), "job")?.text).toBe("Job");
    expect(findTask(root, "job")).toBeNull();
  });

  it("plans a union of two machines without writing", () => {
    const copyA = tmp("tasks-copy-a-");
    const copyB = tmp("tasks-copy-b-");
    dayFile(copyA, "2026-09-01", [row("a", "Alpha", { done: true, completedAt: "2026-09-01T08:00:00.000Z" })]);
    dayFile(copyB, "2026-09-02", [row("a", "Alpha again")]);
    const before = itemBytes(copyA);
    const planned = planTaskDirs([copyA, copyB]);
    expect(planned.report.dropped).toBe(0);
    expect(planned.items).toHaveLength(1);
    expect(planned.items[0]!.done).toBe(true);
    expect(itemBytes(copyA)).toEqual(before);
    expect(fs.readdirSync(copyB)).toEqual(["2026-09-02.json"]);
  });
});

describe("item store", () => {
  it("shows open tasks through today and finished tasks on their end date", () => {
    const dir = tmp("tasks-view-");
    const today = "2026-10-08";
    writeItem(dir, base("open", "Open", { startDate: "2026-10-01", rank: "1" }));
    writeItem(dir, base("done", "Done", { startDate: "2026-10-07", endDate: today, done: true, completedAt: `${today}T09:00:00.000Z`, rank: "2" }));
    writeItem(dir, base("future", "Future", { startDate: "2026-10-20", rank: "3" }));
    const todayTasks = tasksOnDay(dir, today, today);
    expect(todayTasks.map((task) => task.id)).toEqual(["open", "done"]);
    expect(slipDays(todayTasks[0]!, today)).toBe(7);
    const past = tasksOnDay(dir, "2026-10-07", today);
    expect(past.map((task) => task.id)).toEqual(["open", "done"]);
    expect(projectTask(past.find((task) => task.id === "done")!, "2026-10-07").done).toBe(false);
    expect(isVisibleOn(readItems(dir).find((task) => task.id === "future")!, "2026-10-19", today)).toBe(false);
    expect(isVisibleOn(readItems(dir).find((task) => task.id === "future")!, "2026-10-20", today)).toBe(true);
  });

  it("rewrites only the moved task when the order changes", () => {
    const dir = tmp("tasks-rank-");
    const today = "2026-10-08";
    writeItem(dir, base("a", "A", { startDate: today, rank: "1" }));
    writeItem(dir, base("b", "B", { startDate: today, rank: "2" }));
    writeItem(dir, base("c", "C", { startDate: today, rank: "3" }));
    const before = itemBytes(dir);
    reorderOpenTasks(dir, ["b", "a", "c"], today, today);
    const after = itemBytes(dir);
    const changed = Object.keys(after).filter((name) => after[name] !== before[name]);
    expect(changed).toEqual(["b.json"]);
    const open = tasksOnDay(dir, today, today).filter((task) => isTaskOpen(task));
    expect(open.map((task) => task.id)).toEqual(["b", "a", "c"]);
    expect(changedRanks(
      [{ id: "a", rank: "1" }, { id: "b", rank: "2" }, { id: "c", rank: "3" }],
      ["b", "a", "c"],
    ).size).toBe(1);
  });

  it("keeps the timer off the synced item", () => {
    const dir = tmp("tasks-timer-");
    const now = new Date("2026-10-08T12:00:00.000Z");
    const task = createTask(dir, { text: "Timed PTF-1", startDate: "2026-10-08" }, now);
    startTimer(dir, task.id, now);
    const raw = fs.readFileSync(itemPath(dir, task.id), "utf8");
    expect(raw).not.toContain("timerStartedAt");
    stopTimer(dir, task.id, new Date("2026-10-08T12:00:02.000Z"));
    expect(findTask(dir, task.id)?.timeSpentMs).toBe(2000);
    expect(fs.existsSync(path.join(dir, ".local", "timers.json"))).toBe(false);
    const done = patchTask(dir, task.id, { status: "complete" }, now)!;
    expect(done.done).toBe(true);
    expect(done.endDate).toBe("2026-10-08");
    const back = patchTask(dir, task.id, { status: "reactivate" }, now)!;
    expect(isTaskOpen(back)).toBe(true);
    expect(back.jiraKey).toBe("PTF-1");
  });

  it("reads a few thousand items from a warm cache", () => {
    const dir = tmp("tasks-perf-");
    const root = path.join(dir, "items");
    fs.mkdirSync(root, { recursive: true });
    for (let i = 0; i < 5000; i += 1) {
      const id = `t${String(i).padStart(4, "0")}`;
      const task = base(id, `Task ${i}`, { startDate: "2026-10-01", rank: String(i).padStart(6, "0") });
      fs.writeFileSync(path.join(root, `${id}.json`), serializeTask(task));
    }
    invalidateTaskCache(dir);
    const coldStart = performance.now();
    expect(readItems(dir)).toHaveLength(5000);
    const cold = performance.now() - coldStart;
    const warmStart = performance.now();
    expect(readItems(dir)).toHaveLength(5000);
    const warm = performance.now() - warmStart;
    expect(cold).toBeLessThan(3000);
    // Signature check is 5000 stats: ~20ms alone, ~130ms inside the full suite.
    // A cache miss re-parses and lands near the cold read, so warm stays under it.
    expect(warm).toBeLessThan(400);
    expect(warm).toBeLessThan(cold);
  });
});


describe("content-based legacy re-import", () => {
  it.each([
    ["done", { done: true, completedAt: "2026-10-08T12:00:00.000Z" }],
    ["abandoned", { abandonedAt: "2026-10-08T12:00:00.000Z", abandonReason: "old machine" }],
  ])("imports a same-day %s update from an old machine", async (status, closure) => {
    const dir = tmp("tasks-same-day-closure-");
    dayFile(dir, "2026-10-08", [row("a", "Alpha")]);
    await migrateDirectory(dir);
    const rank = findTask(dir, "a")!.rank;

    dayFile(dir, "2026-10-08", [row("a", "Alpha", closure)]);
    const report = await migrateDirectory(dir);
    const task = findTask(dir, "a")!;
    expect(report.problems).toEqual([]);
    expect(task.done).toBe(status === "done");
    expect(task.abandonedAt).toBe(status === "abandoned" ? closure.abandonedAt : undefined);
    expect(task.endDate).toBe("2026-10-08");
    expect(task.rank).toBe(rank);
  });

  it("applies a same-day text edit even when the archived text wins the duplicate tie-break", async () => {
    const dir = tmp("tasks-same-day-text-");
    dayFile(dir, "2026-10-08", [row("a", "Alpha")]);
    await migrateDirectory(dir);
    dayFile(dir, "2026-10-08", [row("a", "Zulu")]);
    await migrateDirectory(dir);
    expect(findTask(dir, "a")?.text).toBe("Zulu");

    const bytes = itemBytes(dir);
    clearMigrationState(dir);
    await migrateDirectory(dir);
    expect(itemBytes(dir)).toEqual(bytes);
  });

  it("applies a same-day link added on an old machine", async () => {
    const dir = tmp("tasks-same-day-link-");
    dayFile(dir, "2026-10-08", [row("a", "Alpha")]);
    await migrateDirectory(dir);
    const links = [{ kind: "repo", id: "example/repo", label: "Repo" }];
    dayFile(dir, "2026-10-08", [row("a", "Alpha", { links })]);
    await migrateDirectory(dir);
    expect(findTask(dir, "a")?.links).toEqual(links);
  });

  it("leaves a reactivated item byte-identical when an unrelated task changes the same day file", async () => {
    const dir = tmp("tasks-same-day-reactivate-");
    const done = row("a", "Alpha", { done: true, completedAt: "2026-10-08T12:00:00.000Z" });
    dayFile(dir, "2026-10-08", [done]);
    await migrateDirectory(dir);
    patchTask(dir, "a", { status: "reactivate", text: "Edited in the new model" });
    const bytes = fs.readFileSync(itemPath(dir, "a"), "utf8");
    const mtime = fs.statSync(itemPath(dir, "a")).mtimeMs;

    dayFile(dir, "2026-10-08", [row("other", "Unrelated"), done]);
    await migrateDirectory(dir);
    expect(isTaskOpen(findTask(dir, "a")!)).toBe(true);
    expect(fs.readFileSync(itemPath(dir, "a"), "utf8")).toBe(bytes);
    expect(fs.statSync(itemPath(dir, "a")).mtimeMs).toBe(mtime);
  });

  it("does not replay an unchanged done closure when the old machine edits its text", async () => {
    const dir = tmp("tasks-same-day-closure-fields-");
    const closure = { done: true, completedAt: "2026-10-08T12:00:00.000Z" };
    dayFile(dir, "2026-10-08", [row("a", "Alpha", closure)]);
    await migrateDirectory(dir);
    patchTask(dir, "a", { status: "reactivate" });
    dayFile(dir, "2026-10-08", [row("a", "Zulu", closure)]);
    await migrateDirectory(dir);
    expect(findTask(dir, "a")?.text).toBe("Zulu");
    expect(isTaskOpen(findTask(dir, "a")!)).toBe(true);
    expect(findTask(dir, "a")?.completedAt).toBeUndefined();
  });

  it("keeps a tombstoned item deleted even when its same-day legacy row changes", async () => {
    const dir = tmp("tasks-same-day-deleted-");
    dayFile(dir, "2026-10-08", [row("a", "Alpha")]);
    await migrateDirectory(dir);
    expect(deleteTask(dir, "a")).toBe(true);
    const tombstone = fs.readFileSync(path.join(deletedDir(dir), "a.json"), "utf8");
    dayFile(dir, "2026-10-08", [row("a", "Zulu", { done: true })]);
    const report = await migrateDirectory(dir);
    expect(report.keptDeleted).toBe(1);
    expect(findTask(dir, "a")).toBeNull();
    expect(fs.readFileSync(path.join(deletedDir(dir), "a.json"), "utf8")).toBe(tombstone);
  });

  it("does not treat formatting, object-key order, or a timer as new legacy information", async () => {
    const dir = tmp("tasks-content-canonical-");
    const closure = { done: true, completedAt: "2026-10-08T12:00:00.000Z" };
    dayFile(dir, "2026-10-08", [row("a", "Alpha", { ...closure, custom: { first: 1, second: 2 } })]);
    await migrateDirectory(dir);
    patchTask(dir, "a", { status: "reactivate", text: "Modern edit" });
    const bytes = itemBytes(dir);
    fs.writeFileSync(path.join(dir, "2026-10-08.json"), JSON.stringify([
      row("a", "Alpha", { custom: { second: 2, first: 1 }, ...closure, timerStartedAt: 123 }),
    ]));
    await migrateDirectory(dir);
    expect(itemBytes(dir)).toEqual(bytes);
  });

  it("does not replay an unchanged moved closure when an older legacy row gets a text edit", async () => {
    const dir = tmp("tasks-content-moved-");
    const moved = { movedAt: "2026-10-07T12:00:00.000Z" };
    dayFile(dir, "2026-10-07", [row("a", "Alpha", moved)]);
    dayFile(dir, "2026-10-08", [row("a", "Alpha", moved)]);
    await migrateDirectory(dir);
    expect(findTask(dir, "a")?.endDate).toBe("2026-10-08");
    fs.rmSync(path.join(dir, "legacy", "2026-10-08.json"));
    dayFile(dir, "2026-10-07", [row("a", "Zulu", moved)]);
    await migrateDirectory(dir);
    expect(findTask(dir, "a")?.text).toBe("Zulu");
    expect(findTask(dir, "a")?.endDate).toBe("2026-10-08");
    expect(findTask(dir, "a")?.endReason).toBe("legacy-moved");
  });

  it("remembers consumed versions when a legacy file disappears and returns", async () => {
    const dir = tmp("tasks-content-return-");
    const done = row("a", "Alpha", { done: true, completedAt: "2026-10-08T12:00:00.000Z" });
    dayFile(dir, "2026-10-08", [done]);
    await migrateDirectory(dir);
    patchTask(dir, "a", { status: "reactivate" });
    const bytes = itemBytes(dir);
    fs.rmSync(path.join(dir, "legacy", "2026-10-08.json"));
    dayFile(dir, "2026-10-08", [row("other", "Unrelated")]);
    await migrateDirectory(dir);
    dayFile(dir, "2026-10-08", [done]);
    await migrateDirectory(dir);
    expect(fs.readFileSync(itemPath(dir, "a"), "utf8")).toBe(bytes["a.json"]);
    expect(isTaskOpen(findTask(dir, "a")!)).toBe(true);
  });

  it("imports newly seen legacy content before legacyThrough and keeps the earliest completion", async () => {
    const dir = tmp("tasks-content-earlier-");
    dayFile(dir, "2026-10-08", [row("a", "Alpha", { done: true, completedAt: "2026-10-08T12:00:00.000Z" })]);
    await migrateDirectory(dir);
    dayFile(dir, "2026-10-07", [row("a", "Earlier", { done: true, completedAt: "2026-10-07T12:00:00.000Z" })]);
    await migrateDirectory(dir);
    expect(findTask(dir, "a")?.completedAt).toBe("2026-10-07T12:00:00.000Z");
    expect(findTask(dir, "a")?.endDate).toBe("2026-10-07");
    expect(findTask(dir, "a")?.legacyThrough).toBe("2026-10-08");
  });

  it.each([undefined, null, ["invalid"], { invalid: 123 }])("baselines older or malformed digest metadata without replaying legacy closure (%j)", async (digests) => {
    const dir = tmp("tasks-content-baseline-");
    const done = row("a", "Alpha", { done: true, completedAt: "2026-10-08T12:00:00.000Z" });
    dayFile(dir, "2026-10-08", [done]);
    await migrateDirectory(dir);
    patchTask(dir, "a", { status: "reactivate", text: "Modern edit" });
    const item = JSON.parse(fs.readFileSync(itemPath(dir, "a"), "utf8")) as Record<string, unknown>;
    delete item.legacyDigest;
    delete item.legacyRowDigests;
    if (digests !== undefined) item.legacyRowDigests = digests;
    fs.writeFileSync(itemPath(dir, "a"), JSON.stringify(item));
    invalidateTaskCache(dir);
    clearMigrationState(dir);
    const report = await migrateDirectory(dir);
    expect(report.problems).toEqual([]);
    expect(isTaskOpen(findTask(dir, "a")!)).toBe(true);
    expect(findTask(dir, "a")?.text).toBe("Modern edit");
    expect(findTask(dir, "a")?.legacyDigest).toMatch(/^[a-f0-9]{64}$/);
    const bytes = itemBytes(dir);
    clearMigrationState(dir);
    await migrateDirectory(dir);
    expect(itemBytes(dir)).toEqual(bytes);

    dayFile(dir, "2026-10-08", [row("a", "Zulu", { done: true, completedAt: "2026-10-08T13:00:00.000Z" })]);
    await migrateDirectory(dir);
    expect(findTask(dir, "a")?.text).toBe("Zulu");
    expect(findTask(dir, "a")?.done).toBe(true);
  });

  it("produces identical bytes when only rollover timestamps and local timers differ", async () => {
    const left = tmp("tasks-volatile-left-");
    const right = tmp("tasks-volatile-right-");
    const union = tmp("tasks-volatile-union-");
    const first = row("a", "Alpha", { movedAt: "2026-10-07T08:26:58.000Z", movedToDate: "2026-10-08", timerStartedAt: 100 });
    const second = row("a", "Alpha", { movedAt: "2026-10-07T08:04:02.000Z", movedToDate: "2026-10-08", timerStartedAt: 200 });
    dayFile(left, "2026-10-07", [first]);
    dayFile(right, "2026-10-07", [second]);
    dayFile(union, "2026-10-07", [first]);
    dayFile(path.join(union, "legacy"), "2026-10-07", [second]);
    for (const dir of [left, right, union]) {
      dayFile(dir, "2026-10-08", [row("a", "Alpha")]);
      await migrateDirectory(dir);
    }
    expect(itemBytes(right)).toEqual(itemBytes(left));
    expect(itemBytes(union)).toEqual(itemBytes(left));
    expect(Object.keys(findTask(union, "a")!.legacyRowDigests ?? {})).toHaveLength(2);
  });

  it("leaves item bytes unchanged when an already imported rollover timestamp changes", async () => {
    const dir = tmp("tasks-volatile-reimport-");
    dayFile(dir, "2026-10-07", [row("a", "Alpha", { movedAt: "2026-10-07T08:26:58.000Z", movedToDate: "2026-10-08" })]);
    await migrateDirectory(dir);
    const bytes = itemBytes(dir);
    const mtime = fs.statSync(itemPath(dir, "a")).mtimeMs;
    dayFile(dir, "2026-10-07", [row("a", "Alpha", { movedAt: "2026-10-07T08:04:02.000Z", movedToDate: "2026-10-08", timerStartedAt: 200 })]);
    await migrateDirectory(dir);
    expect(itemBytes(dir)).toEqual(bytes);
    expect(fs.statSync(itemPath(dir, "a")).mtimeMs).toBe(mtime);
  });

  it.each([
    ["stale open", { done: false }],
    ["later done", { done: true, completedAt: "2026-10-08T13:00:00.000Z" }],
  ])("records a rejected %s version so it cannot replay after a reactivation", async (_status, closure) => {
    const dir = tmp("tasks-rejected-version-");
    dayFile(dir, "2026-10-08", [row("a", "Alpha", { done: true, completedAt: "2026-10-08T12:00:00.000Z" })]);
    await migrateDirectory(dir);
    const before = findTask(dir, "a")!;
    const rejected = row("a", "Alpha", closure);
    dayFile(dir, "2026-10-08", [rejected]);
    await migrateDirectory(dir);
    const after = findTask(dir, "a")!;
    expect({ ...after, legacyDigest: before.legacyDigest, legacyRowDigests: before.legacyRowDigests }).toEqual(before);
    expect(after.legacyDigest).not.toBe(before.legacyDigest);
    expect(Object.keys(after.legacyRowDigests ?? {})).toHaveLength(2);

    patchTask(dir, "a", { status: "reactivate", text: "Modern edit" });
    const bytes = fs.readFileSync(itemPath(dir, "a"), "utf8");
    dayFile(dir, "2026-10-08", [rejected, row("other", "Unrelated")]);
    await migrateDirectory(dir);
    expect(isTaskOpen(findTask(dir, "a")!)).toBe(true);
    expect(findTask(dir, "a")?.text).toBe("Modern edit");
    expect(fs.readFileSync(itemPath(dir, "a"), "utf8")).toBe(bytes);
  });

  it("produces identical re-import bytes on two machines and skips the second run", async () => {
    const left = tmp("tasks-content-left-");
    const right = tmp("tasks-content-right-");
    for (const dir of [left, right]) {
      dayFile(dir, "2026-10-08", [row("a", "Alpha"), row("b", "Beta")]);
      await migrateDirectory(dir);
      dayFile(dir, "2026-10-08", [
        row("a", "Zulu", { done: true, completedAt: "2026-10-08T12:00:00.000Z" }),
        row("b", "Updated Beta"),
      ]);
      await migrateDirectory(dir);
    }
    const bytes = itemBytes(left);
    expect(itemBytes(right)).toEqual(bytes);
    expect(findTask(left, "a")?.done).toBe(true);
    expect(findTask(left, "b")?.text).toBe("Updated Beta");
    for (const dir of [left, right]) {
      const mtimes = readItems(dir).map((task) => fs.statSync(itemPath(dir, task.id)).mtimeMs);
      expect((await migrateDirectory(dir)).skipped).toBe(true);
      clearMigrationState(dir);
      await migrateDirectory(dir);
      expect(itemBytes(dir)).toEqual(bytes);
      expect(readItems(dir).map((task) => fs.statSync(itemPath(dir, task.id)).mtimeMs)).toEqual(mtimes);
    }
  });
});


describe("review fixes", () => {
  it("uses the local calendar day for today", () => {
    expect(todayISO(new Date(2026, 9, 8, 0, 30, 0))).toBe("2026-10-08");
  });

  it("uses the legacy file day as endDate, not the UTC date of completedAt", async () => {
    const dir = tmp("tasks-local-day-");
    dayFile(dir, "2026-10-08", [row("a", "Late", { done: true, completedAt: "2026-10-07T23:30:00.000Z" })]);
    const report = await migrateDirectory(dir);
    expect(report.dropped).toBe(0);
    expect(findTask(dir, "a")?.endDate).toBe("2026-10-08");
  });

  it("does not reopen a reactivated task when a later import has no newer done row", async () => {
    const dir = tmp("tasks-reactivate-");
    dayFile(dir, "2026-09-01", [row("a", "Alpha", { done: true, completedAt: "2026-09-01T08:00:00.000Z" })]);
    await migrateDirectory(dir);
    const done = findTask(dir, "a")!;
    const reopened = { ...done, done: false };
    delete reopened.endDate;
    delete reopened.completedAt;
    writeItem(dir, reopened);
    const before = fs.readFileSync(path.join(dir, "items", "a.json"), "utf8");
    dayFile(dir, "2026-09-02", [row("other", "Unrelated")]);
    await migrateDirectory(dir);
    expect(fs.readFileSync(path.join(dir, "items", "a.json"), "utf8")).toBe(before);
    expect(findTask(dir, "a")?.done).toBe(false);
  });

  it("does not resurrect a deleted legacy task", async () => {
    const dir = tmp("tasks-delete-");
    dayFile(dir, "2026-09-01", [row("a", "Alpha")]);
    await migrateDirectory(dir);
    expect(deleteTask(dir, "a")).toBe(true);
    expect(findTask(dir, "a")).toBeNull();
    expect(fs.existsSync(path.join(deletedDir(dir), "a.json"))).toBe(true);
    dayFile(dir, "2026-09-02", [row("a", "Alpha again")]);
    const report = await migrateDirectory(dir);
    expect(report.dropped).toBe(0);
    expect(report.keptDeleted).toBe(1);
    expect(findTask(dir, "a")).toBeNull();
    expect(fs.existsSync(path.join(deletedDir(dir), "a.json"))).toBe(true);
  });

  it("lets a done row newer than legacyThrough close the item", async () => {
    const dir = tmp("tasks-later-done-");
    dayFile(dir, "2026-09-01", [row("a", "Alpha")]);
    await migrateDirectory(dir);
    expect(findTask(dir, "a")?.done).toBe(false);
    dayFile(dir, "2026-09-03", [row("a", "Alpha done", { done: true, completedAt: "2026-09-03T18:00:00.000Z" })]);
    await migrateDirectory(dir);
    const task = findTask(dir, "a")!;
    expect(task.done).toBe(true);
    expect(task.endDate).toBe("2026-09-03");
    expect(task.text).toBe("Alpha done");
  });

  it("skips an unreadable legacy file and still imports the rest", async () => {
    const dir = tmp("tasks-conflict-");
    dayFile(dir, "2026-09-01", [row("a", "Good")]);
    fs.writeFileSync(path.join(dir, "2026-09-02.json"), "<<<<<<< HEAD\nnot json\n=======\n>>>>>>>\n");
    const report = await migrateDirectory(dir);
    expect(report.dropped).toBe(0);
    expect(findTask(dir, "a")?.text).toBe("Good");
    expect(fs.existsSync(path.join(dir, "2026-09-02.json"))).toBe(true);
    expect(report.unreadable).toEqual(["2026-09-02.json"]);
    expect(report.notice).toContain("unreadable");
    expect((await migrateDirectory(dir)).skipped).toBe(true);
    dayFile(dir, "2026-09-02", [row("b", "Fixed")]);
    const again = await migrateDirectory(dir);
    expect(again.dropped).toBe(0);
    expect(findTask(dir, "b")?.text).toBe("Fixed");
  });

  it("skips an unreadable item file instead of failing the list", () => {
    const dir = tmp("tasks-bad-item-");
    fs.mkdirSync(path.join(dir, "items"), { recursive: true });
    fs.writeFileSync(path.join(dir, "items", "good.json"), serializeTask(base("good", "Good", { startDate: "2026-10-08", rank: "1" })));
    fs.writeFileSync(path.join(dir, "items", "bad.json"), "<<<<<<<\n");
    expect(readItems(dir).map((task) => task.id)).toEqual(["good"]);
    expect(itemReadErrors(dir).join("\n")).toContain("bad.json");
  });

  it("round-trips unknown fields and keeps link order", async () => {
    const dir = tmp("tasks-extra-");
    const linkA = { kind: "note", id: "n", label: "Note", tint: "blue" };
    const linkB = { kind: "jira", id: "PTF-1", label: "Ticket" };
    dayFile(dir, "2026-09-01", [{ ...row("a", "Alpha"), pluginField: "keep", links: [linkA, linkB] }]);
    await migrateDirectory(dir);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "items", "a.json"), "utf8")) as { pluginField?: string; links: { id: string; tint?: string }[] };
    expect(raw.pluginField).toBe("keep");
    expect(raw.links.map((link) => link.id)).toEqual(["n", "PTF-1"]);
    expect(raw.links[0]!.tint).toBe("blue");
    const again = serializeTask({ ...findTask(dir, "a")!, pluginField: "keep" } as never);
    expect(JSON.parse(again).pluginField).toBe("keep");
  });

  it("names a moved-only chain and counts it", async () => {
    const dir = tmp("tasks-orphan-");
    dayFile(dir, "2026-09-01", [row("a", "Gone", { movedAt: "2026-09-01T12:00:00.000Z", movedToDate: "2026-09-02" })]);
    const report = await migrateDirectory(dir);
    expect(report.endedByMove).toBe(1);
    expect(report.endedByMoveSamples[0]?.endReason).toBe("legacy-moved");
    expect(report.dropped).toBe(0);
    expect(findTask(dir, "a")?.endReason).toBe("legacy-moved");
    expect(tasksOnDay(dir, "2026-09-02", "2026-09-02").map((task) => task.id)).not.toContain("a");
  });

  it("steals a dead migration lock and shares one in-process run", async () => {
    const state = tmp("tasks-state-");
    const previous = process.env.DEVHUB_TASK_MIGRATION_DIR;
    process.env.DEVHUB_TASK_MIGRATION_DIR = state;
    try {
      const dir = tmp("tasks-lock-");
      dayFile(dir, "2026-09-01", [row("a", "Alpha")]);
      const real = fs.realpathSync(dir);
      const home = path.join(state, sha256(real));
      fs.mkdirSync(home, { recursive: true });
      fs.writeFileSync(path.join(home, "lock"), "999999\n0\n");
      const [first, second] = await Promise.all([migrateDirectory(dir), migrateDirectory(dir)]);
      expect(first.dropped).toBe(0);
      expect(second.items).toBe(first.items);
      expect(findTask(dir, "a")?.text).toBe("Alpha");
      expect(fs.existsSync(path.join(home, "lock"))).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.DEVHUB_TASK_MIGRATION_DIR;
      else process.env.DEVHUB_TASK_MIGRATION_DIR = previous;
    }
  });
});
describe("migration safety", () => {
  it("ignores an unchanged older legacy snapshot, so a reactivation or delete survives", async () => {
    const dir = tmp("tasks-old-late-");
    dayFile(dir, "2026-09-03", [row("a", "Alpha", { done: true, completedAt: "2026-09-03T08:00:00.000Z" }), row("b", "Beta")]);
    dayFile(dir, "2026-09-05", [row("a", "Alpha", { done: true, completedAt: "2026-09-05T08:00:00.000Z" }), row("b", "Beta")]);
    await migrateDirectory(dir);
    const done = findTask(dir, "a")!;
    const reopened = { ...done, done: false, text: "Alpha edited" };
    delete reopened.endDate;
    delete reopened.completedAt;
    writeItem(dir, reopened);
    expect(deleteTask(dir, "b")).toBe(true);
    // An old-version machine syncs a day that predates what was already imported.
    dayFile(dir, "2026-09-03", [row("a", "Alpha", { done: true, completedAt: "2026-09-03T08:00:00.000Z" }), row("b", "Beta")]);
    const report = await migrateDirectory(dir);
    expect(report.dropped).toBe(0);
    expect(findTask(dir, "a")?.done).toBe(false);
    expect(findTask(dir, "a")?.text).toBe("Alpha edited");
    expect(findTask(dir, "b")).toBeNull();
  });

  it("never throws into the caller", async () => {
    const dir = tmp("tasks-not-a-dir-");
    const file = path.join(dir, "tasks");
    fs.writeFileSync(file, "this is a file, not a directory");
    const report = await migrateDirectory(file);
    expect(report.skipped).toBe(true);
    expect(report.notice).toContain("did not run");
    const root = await migrateTasksRoot(file);
    expect(root.skipped).toBe(true);
    expect(root.notice).toContain("did not run");
    const dry = await migrateDirectory(path.join(file, "nested"), { dryRun: true });
    expect(dry.dryRun).toBe(true);
  });

  it("retries a quarantined file once it is fixed and leaves the rest alone", async () => {
    const dir = tmp("tasks-retry-");
    dayFile(dir, "2026-09-01", [row("a", "Good")]);
    fs.writeFileSync(path.join(dir, "2026-09-02.json"), "<<<<<<< HEAD\n[]\n=======\n[]\n>>>>>>> origin\n");
    const first = await migrateDirectory(dir);
    const bytes = fs.readFileSync(path.join(dir, "items", "a.json"), "utf8");
    expect(first.unreadable).toEqual(["2026-09-02.json"]);
    fs.writeFileSync(path.join(dir, "2026-09-02.json"), `${JSON.stringify([row("a", "Good"), row("c", "Back")])}\n`);
    const second = await migrateDirectory(dir);
    expect(second.unreadable).toEqual([]);
    expect(findTask(dir, "c")?.text).toBe("Back");
    const task = findTask(dir, "a")!;
    expect(task).toEqual({
      ...JSON.parse(bytes),
      legacyThrough: "2026-09-02",
      legacyDigest: task.legacyDigest,
      legacyRowDigests: task.legacyRowDigests,
    });
    expect(task.legacyDigest).not.toBe((JSON.parse(bytes) as Task).legacyDigest);
    expect(Object.keys(task.legacyRowDigests ?? {})).toHaveLength(2);
  });

  it("collapses Friday to Monday but not across an intervening day file without the text", () => {
    const plans = plan([
      { date: "2026-10-02", tasks: [row("f", "Ship")] },
      { date: "2026-10-05", tasks: [row("m", "Ship")] },
    ]);
    expect(plans).toHaveLength(1);
    const split = plan([
      { date: "2026-10-02", tasks: [row("f", "Ship")] },
      { date: "2026-10-03", tasks: [row("x", "Other")] },
      { date: "2026-10-05", tasks: [row("m", "Ship")] },
    ]);
    expect(split.filter((p) => p.task.text === "Ship")).toHaveLength(2);
  });
});

function base(id: string, text: string, extra: Partial<Task>): Task {
  return {
    id,
    text,
    done: false,
    startDate: "2026-10-08",
    rank: "1",
    createdAt: "2026-10-08T00:00:00.000Z",
    ...extra,
  };
}
