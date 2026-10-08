import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collapseRows, dedupeRows, rowsFromJson } from "./chains.ts";
import { migrateDirectory, planTaskDirs } from "./migrate.ts";
import { readItems } from "./store.ts";

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

function rows(days: { date: string; tasks: unknown[] }[], source = "a") {
  return days.flatMap((day) => rowsFromJson(day.tasks, day.date, `${source}/${day.date}`, []));
}

// A rollover with a move, a text-matched hop and a weekend gap. Everything the heuristics touch.
const SEED = [
  { date: "2026-09-04", tasks: [row("a1", "Alpha", { movedAt: "2026-09-04T18:00:00.000Z", movedToDate: "2026-09-07" }), row("b1", "Beta")] },
  { date: "2026-09-07", tasks: [row("a2", "Alpha"), row("b2", "Beta"), row("c1", "Gamma")] },
  { date: "2026-09-08", tasks: [row("a3", "Alpha", { done: true, completedAt: "2026-09-08T09:00:00.000Z" }), row("b3", "Beta"), row("c2", "Gamma")] },
];

describe("duplicate rows", () => {
  it("folds identical copies of a day file into one row", () => {
    const copy = rows(SEED, "copyA");
    const other = rows(SEED, "copyB");
    const deduped = dedupeRows([...copy, ...other]);
    expect(deduped.rows).toHaveLength(copy.length);
    expect(deduped.duplicates).toBe(copy.length);
  });

  it("gives the same chains for one copy, two identical copies and copies in any order", () => {
    const single = collapseRows(rows(SEED, "copyA"));
    const doubled = collapseRows([...rows(SEED, "copyA"), ...rows(SEED, "copyB")]);
    const reversed = collapseRows([...rows(SEED, "copyB"), ...rows(SEED, "copyA")].reverse());
    const shape = (result: ReturnType<typeof collapseRows>) => result.plans.map((p) => ({ ...p.task, rowCount: undefined }));
    expect(doubled.plans).toHaveLength(single.plans.length);
    expect(doubled.ambiguous).toBe(0);
    expect(shape(doubled)).toEqual(shape(single));
    expect(shape(reversed)).toEqual(shape(single));
    expect(doubled.plans.filter((p) => p.task.endReason === "legacy-moved")).toHaveLength(0);
  });

  it("counts distinct ids, not rows, in the movedTo + text heuristic", () => {
    // Two copies of the target day: without dedupe "Alpha" would hit two rows and stay unlinked.
    const days = [
      { date: "2026-09-01", tasks: [row("x1", "Alpha", { movedAt: "2026-09-01T17:00:00.000Z", movedToDate: "2026-09-02" })] },
      { date: "2026-09-02", tasks: [row("x2", "Alpha")] },
    ];
    const result = collapseRows([...rows(days, "copyA"), ...rows(days, "copyB"), ...rows(days, "legacy-copy")]);
    expect(result.ambiguous).toBe(0);
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]!.task.startDate).toBe("2026-09-01");
  });

  it("still reports a real ambiguity between two different ids", () => {
    const days = [
      { date: "2026-09-01", tasks: [row("x1", "Alpha", { movedAt: "2026-09-01T17:00:00.000Z", movedToDate: "2026-09-02" })] },
      { date: "2026-09-02", tasks: [row("x2", "Alpha"), row("x3", "Alpha")] },
    ];
    expect(collapseRows(rows(days)).ambiguous).toBe(1);
  });

  it("merges conflicting duplicates with done > abandoned > open > moved and the earliest completion", () => {
    const day = "2026-09-01";
    const open = rows([{ date: day, tasks: [row("t", "Task")] }], "left");
    const abandoned = rows([{ date: day, tasks: [row("t", "Task", { abandonedAt: "2026-09-01T10:00:00.000Z" })] }], "mid");
    const lateDone = rows([{ date: day, tasks: [row("t", "Task", { done: true, completedAt: "2026-09-01T15:00:00.000Z" })] }], "right");
    const earlyDone = rows([{ date: day, tasks: [row("t", "Task", { done: true, completedAt: "2026-09-01T09:00:00.000Z" })] }], "far");
    const moved = rows([{ date: day, tasks: [row("t", "Task", { movedAt: "2026-09-01T20:00:00.000Z", movedToDate: "2026-09-02" })] }], "m");

    const winner = (...inputs: ReturnType<typeof rows>[]) => dedupeRows(inputs.flat()).rows[0]!.task;
    expect(winner(open, abandoned, lateDone, earlyDone).completedAt).toBe("2026-09-01T09:00:00.000Z");
    expect(winner(moved, open).movedAt).toBeUndefined();
    expect(winner(moved, abandoned, open).abandonedAt).toBeDefined();
    expect(winner(open, moved).done).toBe(false);
    expect(winner(moved).movedAt).toBeDefined();
    // Order of the inputs must not matter.
    expect(winner(earlyDone, lateDone, open)).toEqual(winner(open, lateDone, earlyDone));
  });

  it("keeps fields only one copy carries", () => {
    const left = rows([{ date: "2026-09-01", tasks: [row("t", "Task", { done: true, completedAt: "2026-09-01T09:00:00.000Z" })] }], "left");
    const right = rows([{ date: "2026-09-01", tasks: [row("t", "Task", { notePath: "task-notes/x", timeSpentMs: 90, jiraKey: "ABC-1" })] }], "right");
    const merged = dedupeRows([...left, ...right]).rows[0]!.task;
    expect(merged.done).toBe(true);
    expect(merged.notePath).toBe("task-notes/x");
    expect(merged.timeSpentMs).toBe(90);
    expect(merged.jiraKey).toBe("ABC-1");
  });
});

describe("two machines meeting", () => {
  it("plans two identical day-file sets exactly like one", () => {
    const copyA = tmp("dedupe-copy-a-");
    const copyB = tmp("dedupe-copy-b-");
    for (const dir of [copyA, copyB]) for (const day of SEED) dayFile(dir, day.date, day.tasks);
    const one = planTaskDirs([copyA]);
    const both = planTaskDirs([copyA, copyB]);
    expect(both.items).toEqual(one.items);
    expect(both.report.items).toBe(one.report.items);
    expect(both.report.ambiguous).toBe(0);
    expect(both.report.endedByMove).toBe(one.report.endedByMove);
    expect(both.report.dropped).toBe(0);
    expect(both.report.duplicateRows).toBeGreaterThan(0);
  });

  it("imports root, legacy/ and legacy/conflicts copies of the same day without fragmenting a chain", async () => {
    const dir = tmp("dedupe-copies-");
    for (const day of SEED) dayFile(dir, day.date, day.tasks);
    for (const day of SEED) dayFile(path.join(dir, "legacy"), day.date, day.tasks);
    for (const day of SEED) dayFile(path.join(dir, "legacy", "conflicts"), day.date, day.tasks, `0123456789ab-${day.date}.json`);
    const report = await migrateDirectory(dir);
    expect(report.dropped).toBe(0);
    expect(report.ambiguous).toBe(0);
    const items = readItems(dir);
    expect(items).toHaveLength(3);
    expect(items.filter((item) => item.endReason === "legacy-moved")).toHaveLength(0);
    expect(items.find((item) => item.text === "Alpha")?.startDate).toBe("2026-09-04");
    expect(items.find((item) => item.text === "Alpha")?.done).toBe(true);
  });

  it("keeps a task done when a stale machine still has it open", () => {
    const copyA = tmp("stale-copy-a-");
    const stale = tmp("stale-stale-");
    dayFile(copyA, "2026-09-01", [row("t", "Task")]);
    dayFile(copyA, "2026-09-02", [row("t", "Task", { done: true, completedAt: "2026-09-02T09:00:00.000Z" })]);
    // The stale machine never saw the close and rolled the task forward on its own ids.
    dayFile(stale, "2026-09-01", [row("t", "Task")]);
    dayFile(stale, "2026-09-02", [row("t", "Task")]);
    dayFile(stale, "2026-09-03", [row("s", "Task", { rolledFromId: "t" })]);
    const planned = planTaskDirs([copyA, stale]);
    expect(planned.items).toHaveLength(1);
    expect(planned.items[0]!.done).toBe(true);
    expect(planned.items[0]!.endDate).toBe("2026-09-02");
    expect(planned.report.dropped).toBe(0);
  });
});

// Opt-in. DEVHUB_TASKS_REAL_DATA points at a directory with a/tasks, b/tasks and stale/tasks.
const realRoot = process.env.DEVHUB_TASKS_REAL_DATA ?? "";
const haveRealData = Boolean(process.env.DEVHUB_TASKS_REAL_DATA) && ["a/tasks", "b/tasks", "stale/tasks"].every((rel) => fs.existsSync(path.join(realRoot, rel)));

describe.skipIf(!haveRealData)("real copies from machine A, machine B and a stale copy", () => {
  const copyA = path.join(realRoot, "a/tasks");
  const copyB = path.join(realRoot, "b/tasks");
  const stale = path.join(realRoot, "stale/tasks");

  it("machine A + machine B is exactly the single-copy result", () => {
    const one = planTaskDirs([copyA]);
    const both = planTaskDirs([copyA, copyB]);
    expect(one.report.items).toBeGreaterThan(0);
    expect(both.report.items).toBe(one.report.items);
    expect(both.report.ambiguous).toBe(0);
    expect(both.report.endedByMove).toBe(one.report.endedByMove);
    expect(both.report.dropped).toBe(0);
    expect(both.items).toEqual(one.items);
  });

  it("machine A + machine B + a stale copy keeps every task machine A closed closed, and adds nothing", () => {
    const one = planTaskDirs([copyA]);
    const all = planTaskDirs([copyA, copyB, stale]);
    expect(all.report.items).toBe(one.report.items);
    expect(all.report.dropped).toBe(0);
    expect(all.report.ambiguous).toBe(0);
    expect(all.report.conflicts.length).toBeGreaterThan(0);
    const keyed = (items: typeof one.items) => new Map(items.map((item) => [item.id, item]));
    const after = keyed(all.items);
    for (const item of one.items) {
      const next = after.get(item.id)!;
      expect(next, item.text).toBeDefined();
      expect(next.done).toBe(item.done);
      expect(next.endDate).toBe(item.endDate);
      expect(next.completedAt).toBe(item.completedAt);
      expect(next.abandonedAt).toBe(item.abandonedAt);
      expect(next.startDate).toBe(item.startDate);
      expect(next.text).toBe(item.text);
    }
    expect(all.items.filter((item) => !item.done && !item.endDate)).toHaveLength(one.items.filter((item) => !item.done && !item.endDate).length);
  });

  it("moves no start date when the identical copy is added", () => {
    const one = planTaskDirs([copyA]);
    const both = planTaskDirs([copyA, copyB]);
    const starts = (items: typeof one.items) => items.map((item) => `${item.id}:${item.startDate}`).sort();
    expect(starts(both.items)).toEqual(starts(one.items));
  });
});
