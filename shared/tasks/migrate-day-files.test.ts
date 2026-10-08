import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateTasksRoot } from "./migrate.ts";
import { sha256 } from "./paths.ts";
import { findTask, patchTask, readItems, tasksOnDay } from "./store.ts";

/**
 * Contract tests for the day-file -> item migration, driven through
 * `migrateTasksRoot`: the entry point `ensureTasksMigrated` calls on first
 * start. Every input is a generic fixture day file written into a temp dir;
 * nothing here reads a real tasks/ directory.
 */

const dirs: string[] = [];
let stateHome: string;
let previousStateHome: string | undefined;
let previousTz: string | undefined;

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

beforeEach(() => {
  // Own the state dir so the backup is inspectable and runs cannot share state.
  previousStateHome = process.env.DEVHUB_TASK_MIGRATION_DIR;
  previousTz = process.env.TZ;
  stateHome = tmp("task-migration-state-");
  process.env.DEVHUB_TASK_MIGRATION_DIR = stateHome;
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (previousStateHome === undefined) delete process.env.DEVHUB_TASK_MIGRATION_DIR;
  else process.env.DEVHUB_TASK_MIGRATION_DIR = previousStateHome;
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function dayFile(dir: string, date: string, tasks: unknown): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${date}.json`), `${JSON.stringify(tasks, null, 2)}\n`);
}

function rawDayFile(dir: string, date: string, body: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${date}.json`), body);
}

function row(id: string, text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, text, done: false, createdAt: "2026-09-01T00:00:00.000Z", ...extra };
}

/** Relative path -> content hash for every file under `root`. Order-independent. */
function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else out[path.relative(root, full)] = sha256(fs.readFileSync(full));
    }
  };
  if (fs.existsSync(root)) visit(root);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function itemFiles(dir: string): string[] {
  const items = path.join(dir, "items");
  return fs.existsSync(items) ? fs.readdirSync(items).filter((name) => name.endsWith(".json")).sort() : [];
}

/** The per-tasks-dir state the migration keeps outside the tasks dir. */
function stateOf(): { dir: string; state: { backedUp?: boolean; backupPath?: string }; backup: string } {
  const [name, ...rest] = fs.readdirSync(stateHome);
  expect(name, "migration wrote its state under the injected home").toBeDefined();
  expect(rest).toEqual([]);
  const dir = path.join(stateHome, name!);
  const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")) as { backedUp?: boolean; backupPath?: string };
  return { dir, state, backup: path.join(dir, "backup") };
}

describe("a task spanning several days", () => {
  it("becomes exactly one item covering the first to the last day", async () => {
    const dir = tmp("day-span-");
    // The rollover gives the same task a fresh id each morning and links it back.
    // The text is edited along the way, so only rolledFromId can join the days.
    dayFile(dir, "2026-09-07", [row("w1", "Write release notes"), row("x1", "Unrelated errand", { done: true, completedAt: "2026-09-07T10:00:00.000Z" })]);
    dayFile(dir, "2026-09-08", [row("w2", "Write release notes v2", { rolledFromId: "w1" })]);
    dayFile(dir, "2026-09-09", [row("w3", "Write release notes v3", { rolledFromId: "w2" })]);
    dayFile(dir, "2026-09-10", [row("w4", "Write release notes (final)", { rolledFromId: "w3", done: true, completedAt: "2026-09-10T15:00:00.000Z" })]);

    const report = await migrateTasksRoot(dir);

    expect(report.dropped).toBe(0);
    expect(report.legacyRows).toBe(5);
    expect(report.chains).toBe(2);
    expect(itemFiles(dir)).toEqual(["w1.json", "x1.json"]);
    const span = findTask(dir, "w1")!;
    expect(span.text).toBe("Write release notes (final)");
    expect(span.startDate).toBe("2026-09-07");
    expect(span.endDate).toBe("2026-09-10");
    expect(span.done).toBe(true);
    expect(span.legacyIds).toEqual(["w1", "w2", "w3", "w4"]);
    // The later per-day ids are folded into the survivor, never items of their own.
    expect(readItems(dir).map((task) => task.id).sort()).toEqual(["w1", "x1"]);
    // The unrelated one-day task stays its own item.
    expect(findTask(dir, "x1")).toMatchObject({ startDate: "2026-09-07", endDate: "2026-09-07", done: true });
  });

  it("stays one open item when it was linked by text and a move rather than by rolledFromId", async () => {
    const dir = tmp("day-span-text-");
    dayFile(dir, "2026-09-07", [row("a1", "Review the backlog", { movedAt: "2026-09-07T18:00:00.000Z", movedToDate: "2026-09-08" })]);
    dayFile(dir, "2026-09-08", [row("a2", "Review the backlog")]);
    dayFile(dir, "2026-09-09", [row("a3", "Review the backlog")]);

    const report = await migrateTasksRoot(dir);

    expect(report.dropped).toBe(0);
    expect(report.ambiguous).toBe(0);
    const items = readItems(dir);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "a1", startDate: "2026-09-07", done: false });
    expect(items[0]!.endDate).toBeUndefined();
  });
});

describe("a task reopened after it was done", () => {
  it("is one item when the day files disagree about whether it was finished", async () => {
    const dir = tmp("reopen-days-");
    dayFile(dir, "2026-09-07", [row("t1", "Fix the flaky check")]);
    dayFile(dir, "2026-09-08", [row("t1", "Fix the flaky check", { done: true, completedAt: "2026-09-08T09:00:00.000Z" })]);
    // A stale copy, or a rollover that ran before the close synced, shows it open again.
    dayFile(dir, "2026-09-09", [row("t2", "Fix the flaky check", { rolledFromId: "t1" })]);

    const report = await migrateTasksRoot(dir);

    expect(report.dropped).toBe(0);
    expect(itemFiles(dir)).toEqual(["t1.json"]);
    expect(readItems(dir)).toHaveLength(1);
    expect(findTask(dir, "t1")).toMatchObject({ done: true, startDate: "2026-09-07", endDate: "2026-09-08" });
  });

  it("is not duplicated by a later import after the user reopened the migrated item", async () => {
    const dir = tmp("reopen-after-");
    dayFile(dir, "2026-09-07", [row("t1", "Fix the flaky check")]);
    dayFile(dir, "2026-09-08", [row("t1", "Fix the flaky check", { done: true, completedAt: "2026-09-08T09:00:00.000Z" })]);
    await migrateTasksRoot(dir);
    expect(findTask(dir, "t1")?.done).toBe(true);

    patchTask(dir, "t1", { status: "reactivate" });
    expect(findTask(dir, "t1")).toMatchObject({ done: false });

    // Another machine, still on day files, syncs a later day carrying the same task.
    dayFile(dir, "2026-09-09", [row("t2", "Fix the flaky check", { rolledFromId: "t1" })]);
    const report = await migrateTasksRoot(dir);

    expect(report.dropped).toBe(0);
    expect(itemFiles(dir)).toEqual(["t1.json"]);
    expect(readItems(dir)).toHaveLength(1);
    expect(readItems(dir).map((task) => task.id)).toEqual(["t1"]);
    expect(findTask(dir, "t1")?.done).toBe(false);
  });
});

describe("a task created just after midnight", () => {
  // The file name is the user's local day. The UTC date inside a timestamp can
  // be the day before (a UTC+ zone) or the day after (a UTC- evening).
  const fixture = (dir: string) => {
    dayFile(dir, "2026-10-07", [
      row("e1", "Evening task", { createdAt: "2026-10-07T22:50:00.000Z" }),
      row("e1b", "Finished after midnight", { createdAt: "2026-10-07T20:00:00.000Z" }),
    ]);
    dayFile(dir, "2026-10-08", [
      row("m1", "Created 00:30 at UTC+1", { createdAt: "2026-10-07T23:30:00.000Z" }),
      row("m2", "Created with no timestamp", { createdAt: undefined }),
      row("m3", "Created 00:05 at UTC", { createdAt: "2026-10-08T00:05:00.000Z" }),
      row("e1b", "Finished after midnight", { createdAt: "2026-10-07T20:00:00.000Z", done: true, completedAt: "2026-10-07T23:20:00.000Z" }),
    ]);
  };

  it.each(["UTC", "Pacific/Auckland", "America/Los_Angeles"])("lands on the day of its file under TZ=%s", async (zone) => {
    process.env.TZ = zone;
    const dir = tmp("midnight-");
    fixture(dir);

    const report = await migrateTasksRoot(dir);

    expect(report.dropped).toBe(0);
    expect(findTask(dir, "m1")?.startDate).toBe("2026-10-08");
    expect(findTask(dir, "m2")?.startDate).toBe("2026-10-08");
    expect(findTask(dir, "m3")?.startDate).toBe("2026-10-08");
    expect(findTask(dir, "e1")?.startDate).toBe("2026-10-07");
    // Created the evening before, closed 00:20 local: it ends on the file's day, not the UTC date.
    expect(findTask(dir, "e1b")).toMatchObject({ startDate: "2026-10-07", endDate: "2026-10-08", done: true });
  });

  it("is listed on its own day and not on the day before", async () => {
    const dir = tmp("midnight-view-");
    fixture(dir);
    await migrateTasksRoot(dir);

    const ids = (day: string) => tasksOnDay(dir, day, "2026-10-08").map((task) => task.id).sort();
    expect(ids("2026-10-07")).toEqual(["e1", "e1b"]);
    expect(ids("2026-10-08")).toEqual(expect.arrayContaining(["m1", "m2", "m3", "e1b"]));
  });
});

describe("running the migration again", () => {
  const seed = (dir: string) => {
    dayFile(dir, "2026-09-07", [row("w1", "Write release notes"), row("b1", "Book travel")]);
    dayFile(dir, "2026-09-08", [row("w2", "Write release notes", { rolledFromId: "w1" }), row("b1", "Book travel", { done: true, completedAt: "2026-09-08T11:00:00.000Z" })]);
  };

  it("is a no-op: same items, same files, one backup, nothing new", async () => {
    const dir = tmp("rerun-");
    const original = tmp("rerun-original-");
    seed(dir);
    seed(original);

    const first = await migrateTasksRoot(dir);
    expect(first.skipped).toBe(false);
    expect(first.items).toBe(2);

    const { dir: stateDir, state, backup } = stateOf();
    expect(state.backedUp).toBe(true);
    expect(state.backupPath).toBe(backup);
    // The backup is the pre-migration tasks dir: the day files, byte for byte, and no items yet.
    expect(tree(path.join(backup, "tasks"))).toEqual(tree(original));

    const tasksBefore = tree(dir);
    const stateBefore = tree(stateDir);
    const itemsBefore = readItems(dir);

    // A restart, a second tab and a concurrent caller all re-enter the same entry point.
    const again = await migrateTasksRoot(dir);
    const [raceA, raceB] = await Promise.all([migrateTasksRoot(dir), migrateTasksRoot(dir)]);
    for (const report of [again, raceA, raceB]) {
      expect(report.skipped).toBe(true);
      expect(report.dropped).toBe(0);
    }

    expect(readItems(dir)).toEqual(itemsBefore);
    expect(itemFiles(dir)).toEqual(["b1.json", "w1.json"]);
    expect(tree(dir)).toEqual(tasksBefore);
    // state.json, report.md and the backup are all untouched, so no second backup was taken.
    expect(tree(stateDir)).toEqual(stateBefore);
    expect(fs.readdirSync(stateHome)).toHaveLength(1);
    expect(stateOf().state).toEqual(state);
    expect(tree(path.join(backup, "tasks"))).toEqual(tree(original));
  });

  it("does not take a second backup when a later day file makes it import again", async () => {
    const dir = tmp("rerun-late-");
    const original = tmp("rerun-late-original-");
    seed(dir);
    seed(original);
    await migrateTasksRoot(dir);
    const { backup, state } = stateOf();
    const pristine = tree(path.join(backup, "tasks"));

    dayFile(dir, "2026-09-09", [row("n1", "Late arrival from another machine")]);
    const later = await migrateTasksRoot(dir);

    expect(later.skipped).toBe(false);
    expect(readItems(dir).map((task) => task.id).sort()).toEqual(["b1", "n1", "w1"]);
    expect(stateOf().state).toMatchObject({ backedUp: true, backupPath: state.backupPath });
    // Still the first backup: it never gained the items/ or the late file.
    expect(tree(path.join(backup, "tasks"))).toEqual(pristine);
    expect(pristine).toEqual(tree(original));
  });
});

describe("a malformed day file", () => {
  const malformed: [string, string][] = [
    ["merge-conflict markers", "<<<<<<< HEAD\n[]\n=======\n[]\n>>>>>>> other\n"],
    ["truncated JSON", '[{"id":"z1","text":"Cut off mid-wri'],
    ["a JSON object instead of a task array", '{"tasks":[]}\n'],
    ["JSON null", "null\n"],
    ["an empty file", ""],
  ];

  it.each(malformed)("(%s) is left in place while the other days still migrate", async (_label, body) => {
    const dir = tmp("malformed-");
    dayFile(dir, "2026-09-07", [row("w1", "Write release notes"), row("g1", "Plan the week")]);
    rawDayFile(dir, "2026-09-08", body);
    dayFile(dir, "2026-09-09", [row("w2", "Write release notes", { rolledFromId: "w1" }), row("h1", "Another day")]);

    const report = await migrateTasksRoot(dir);

    // Nothing thrown, nothing lost: the good days are items, and the bad file is flagged, not consumed.
    expect(report.unreadable).toEqual(["2026-09-08.json"]);
    expect(report.notice).toContain("unreadable");
    expect(report.dropped).toBe(0);
    expect(readItems(dir).map((task) => task.id).sort()).toEqual(["g1", "h1", "w1"]);
    // The chain still joins across the gap through rolledFromId.
    expect(findTask(dir, "w1")).toMatchObject({ startDate: "2026-09-07", legacyIds: ["w1", "w2"] });
    expect(fs.readFileSync(path.join(dir, "2026-09-08.json"), "utf8")).toBe(body);
    expect(fs.existsSync(path.join(dir, "legacy", "2026-09-08.json"))).toBe(false);
    // The good day files were archived as usual.
    expect(fs.existsSync(path.join(dir, "legacy", "2026-09-07.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "legacy", "2026-09-09.json"))).toBe(true);
    // The backup holds the malformed file too, so nothing is only in the live dir.
    expect(fs.readFileSync(path.join(stateOf().backup, "tasks", "2026-09-08.json"), "utf8")).toBe(body);
  });

  it("keeps the readable rows of a file that has a few bad rows", async () => {
    const dir = tmp("malformed-rows-");
    dayFile(dir, "2026-09-07", [row("g1", "Plan the week"), null, "not a task", 42, row("g2", "Review the plan")]);

    const report = await migrateTasksRoot(dir);

    expect(report.dropped).toBe(0);
    expect(report.unreadable).toEqual([]);
    expect(report.problems.length).toBeGreaterThan(0);
    expect(readItems(dir).map((task) => task.id).sort()).toEqual(["g1", "g2"]);
  });

  it("stays quiet and safe on every later run, then imports the file once it is repaired", async () => {
    const dir = tmp("malformed-repair-");
    dayFile(dir, "2026-09-07", [row("g1", "Plan the week")]);
    rawDayFile(dir, "2026-09-08", "<<<<<<< HEAD\n");
    await migrateTasksRoot(dir);
    const before = tree(dir);

    const again = await migrateTasksRoot(dir);
    expect(again.skipped).toBe(true);
    expect(tree(dir)).toEqual(before);
    expect(readItems(dir)).toHaveLength(1);

    dayFile(dir, "2026-09-08", [row("g1", "Plan the week"), row("r1", "Recovered task")]);
    const repaired = await migrateTasksRoot(dir);
    expect(repaired.unreadable).toEqual([]);
    expect(readItems(dir).map((task) => task.id).sort()).toEqual(["g1", "r1"]);
    expect(fs.existsSync(path.join(dir, "2026-09-08.json"))).toBe(false);
  });
});
