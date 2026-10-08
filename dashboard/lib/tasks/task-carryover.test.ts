import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/tasks/route";
import { taskNotePath } from "@/lib/task-note";
import { resolveEntityLinks } from "@/lib/entity-links/resolve";
import { collectOpenPrerequisiteBlockers } from "./implement-ready-gather";
import { buildPlanMarkdown } from "./plan-markdown";
import { ensureTasksMigrated, getTasks, listTaskDays } from "./storage";
import { getTaskAgentRuns, lookupTaskIdForRun, upsertTaskAgentRun } from "./task-agent-runs";
import type { Task } from "./types";

const OLD = "11111111-1111-4111-8111-111111111111";
const CURRENT = "22222222-2222-4222-8222-222222222222";
const RUN = "run-m1abc2-deadbeef";
const task = (id: string, fields: Partial<Task> = {}): Task => ({
  id,
  text: "Document analytics",
  done: false,
  startDate: "2026-09-23",
  rank: "1",
  createdAt: "2026-09-23T09:00:00.000Z",
  ...fields,
});

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-carryover-"));
  vi.stubEnv("REPO_ROOT", root);
  vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
  vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-24T12:00:00.000Z"));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

function writeDay(date: string, tasks: Task[]) {
  const dir = path.join(root, "tasks");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${date}.json`), `${JSON.stringify(tasks, null, 2)}\n`);
}

function writePlan(notePath: string) {
  const file = path.join(root, "notes", `${notePath}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify([
    { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Plan" }] },
    { type: "paragraph", content: [{ type: "text", text: "Inventory every analytics event." }] },
  ]));
}

describe("task continuity across daily history", () => {
  it("keeps the earliest id, the plan, and agent history when day files collapse", async () => {
    const notePath = `task-notes/2026-09-23-${OLD}`;
    const links: Task["links"] = [{ kind: "repo", id: "app", label: "app" }];
    writeDay("2026-09-23", [task(OLD, { links, movedAt: "2026-09-24T06:00:00Z", movedToDate: "2026-09-24" })]);
    writeDay("2026-09-24", [task(CURRENT, { links, rolledFromId: OLD, rolledFromDate: "2026-09-23" })]);
    writePlan(notePath);
    const noteBefore = fs.readFileSync(path.join(root, "notes", `${notePath}.json`), "utf8");
    await upsertTaskAgentRun({ taskId: CURRENT, runId: RUN, status: "running" });
    await ensureTasksMigrated();

    const today = getTasks("2026-09-24")[0]!;
    expect(today.id).toBe(OLD);
    expect(today.notePath).toBe(notePath);
    const response = await GET(new Request(`http://localhost/api/tasks?taskId=${CURRENT}`));
    expect(await response.json()).toMatchObject({ date: "2026-09-24", tasks: [{ id: OLD, notePath }] });
    expect(taskNotePath({ ...today, date: "2026-09-24" })).toBe(notePath);
    expect(listTaskDays()[0]!.tasks[0]!.notePath).toBe(notePath);
    expect(buildPlanMarkdown(today, "2026-09-24")).toContain("Inventory every analytics event.");
    expect(resolveEntityLinks("task", CURRENT).notes.map((n) => n.id)).toContain(notePath);

    for (const date of ["2026-09-25", "2026-09-26"]) {
      vi.setSystemTime(new Date(`${date}T12:00:00.000Z`));
      await ensureTasksMigrated();
      const open = getTasks();
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({ id: OLD, links, notePath, createdAt: today.createdAt });
      expect(getTaskAgentRuns(OLD).runs[0]?.runId).toBe(RUN);
      expect(lookupTaskIdForRun(RUN)).toBe(OLD);
      expect(resolveEntityLinks("task", CURRENT).notes.map((n) => n.id)).toContain(notePath);
    }
    expect(getTasks("2026-09-24")[0]).toMatchObject({ id: OLD, done: false });
    expect(fs.readFileSync(path.join(root, "notes", `${notePath}.json`), "utf8")).toBe(noteBefore);
    expect(fs.readdirSync(path.join(root, "notes", "task-notes"))).toEqual([`2026-09-23-${OLD}.json`]);
  });

  it("imports a day file once", async () => {
    writeDay("2026-09-23", [task(CURRENT)]);
    await ensureTasksMigrated();
    await ensureTasksMigrated();
    expect(getTasks("2026-09-24")).toHaveLength(1);
    expect(getTasks("2026-09-24")[0]?.id).toBe(CURRENT);
    expect(getTasks("2026-09-23")).toHaveLength(1);
  });

  it("does not leave a finished task open after a later done snapshot", async () => {
    writeDay("2026-09-22", [task(CURRENT)]);
    writeDay("2026-09-23", [task(CURRENT, { done: true, completedAt: "2026-09-23T17:00:00Z" })]);
    await ensureTasksMigrated();
    expect(getTasks()).toEqual([]);
    expect(getTasks("2026-09-23")[0]).toMatchObject({ id: CURRENT, done: true, endDate: "2026-09-23" });
    expect(getTasks("2026-09-22")[0]?.done).toBe(false);
  });

  it("resolves prerequisites through old ids onto the surviving item", async () => {
    const work = task(CURRENT, { rolledFromId: OLD, rolledFromDate: "2026-09-23" });
    const oldBlocker = task("blocker-old", { text: "Backend #prerequisite", movedAt: "2026-09-24T06:00:00Z" });
    const blocker = task("blocker", {
      text: "Backend #prerequisite",
      rolledFromId: oldBlocker.id,
      rolledFromDate: "2026-09-23",
      links: [{ kind: "task", id: OLD, label: "Work" }],
    });
    writeDay("2026-09-23", [task(OLD, { movedAt: "2026-09-24T06:00:00Z" }), oldBlocker]);
    writeDay("2026-09-24", [work, blocker]);
    await ensureTasksMigrated();
    const refs: Task["links"] = [{ kind: "task", id: oldBlocker.id, label: "Backend" }];
    expect(collectOpenPrerequisiteBlockers(CURRENT, refs).map((b) => b.id)).toEqual(["blocker-old"]);
    expect(collectOpenPrerequisiteBlockers(CURRENT, []).map((b) => b.id)).toEqual(["blocker-old"]);

    writeDay("2026-09-25", [work, { ...blocker, done: true, completedAt: "2026-09-25T17:00:00.000Z" }]);
    await ensureTasksMigrated();
    expect(collectOpenPrerequisiteBlockers(CURRENT, refs)).toEqual([]);
    const related = resolveEntityLinks("task", CURRENT);
    expect(related.related.filter((r) => r.id === "blocker-old")).toHaveLength(1);
    expect(related.taskAliases?.["blocker"]).toMatchObject({ id: "blocker-old", href: "/work?date=2026-09-25" });
  });
});
