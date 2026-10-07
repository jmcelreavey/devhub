import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as atomic from "@/lib/atomic-write";
import { GET } from "@/app/api/tasks/route";
import { taskNotePath } from "@/lib/task-note";
import { resolveEntityLinks } from "@/lib/entity-links/resolve";
import { collectOpenPrerequisiteBlockers } from "./implement-ready-gather";
import { buildPlanMarkdown } from "./plan-markdown";
import { getTasks, listTaskDays, rolloverTasks, saveTasks } from "./storage";
import { getTaskAgentRuns, lookupTaskIdForRun, upsertTaskAgentRun } from "./task-agent-runs";
import type { Task } from "./types";

const OLD = "11111111-1111-4111-8111-111111111111";
const CURRENT = "22222222-2222-4222-8222-222222222222";
const RUN = "run-m1abc2-deadbeef";
const task = (id: string, fields: Partial<Task> = {}): Task => ({
  id, text: "Document analytics", done: false, createdAt: "2026-09-23T09:00:00.000Z", ...fields,
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

function writePlan(notePath: string) {
  const file = path.join(root, "notes", `${notePath}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify([
    { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Plan" }] },
    { type: "paragraph", content: [{ type: "text", text: "Inventory every analytics event." }] },
  ]));
}

describe("task continuity across daily history", () => {
  it("recovers an old plan, then keeps identity, links, timestamps and agent history across repeated rollover", async () => {
    const notePath = `task-notes/2026-09-23-${OLD}`;
    const links: Task["links"] = [{ kind: "repo", id: "app", label: "app" }];
    await saveTasks("2026-09-23", [task(OLD, { links, movedAt: "2026-09-24T06:00:00Z", movedToDate: "2026-09-24" })]);
    await saveTasks("2026-09-24", [task(CURRENT, { links, rolledFromId: OLD, rolledFromDate: "2026-09-23" })]);
    writePlan(notePath);
    const noteBefore = fs.readFileSync(path.join(root, "notes", `${notePath}.json`), "utf8");
    await upsertTaskAgentRun({ taskId: CURRENT, runId: RUN, status: "running" });

    const today = getTasks("2026-09-24")[0]!;
    expect(today.notePath).toBe(notePath);
    const response = await GET(new Request(`http://localhost/api/tasks?taskId=${OLD}`));
    expect(await response.json()).toMatchObject({ date: "2026-09-24", tasks: [{ id: CURRENT, notePath }] });
    expect(taskNotePath({ ...today, date: "2026-09-24" })).toBe(notePath);
    expect(listTaskDays()[0]!.tasks[0]!.notePath).toBe(notePath);
    expect(buildPlanMarkdown(today, "2026-09-24")).toContain("Inventory every analytics event.");
    expect(resolveEntityLinks("task", CURRENT).notes.map((n) => n.id)).toContain(notePath);

    for (const date of ["2026-09-25", "2026-09-26"]) {
      vi.setSystemTime(new Date(`${date}T12:00:00.000Z`));
      const carried = await rolloverTasks();
      expect(carried).toHaveLength(1);
      expect(carried[0]).toMatchObject({ id: CURRENT, links, notePath, createdAt: today.createdAt });
      expect(await rolloverTasks()).toEqual(carried);
      expect(getTaskAgentRuns(CURRENT).runs[0]?.runId).toBe(RUN);
      expect(lookupTaskIdForRun(RUN)).toBe(CURRENT);
      expect(resolveEntityLinks("task", OLD).notes.map((n) => n.id)).toContain(notePath);
    }
    expect(getTasks("2026-09-24")[0]).toMatchObject({ id: CURRENT, movedToDate: "2026-09-25" });
    expect(fs.readFileSync(path.join(root, "notes", `${notePath}.json`), "utf8")).toBe(noteBefore);
    expect(fs.readdirSync(path.join(root, "notes", "task-notes"))).toEqual([`2026-09-23-${OLD}.json`]);
  });

  it("keeps today's task when marking yesterday fails, then repairs history without duplicates", async () => {
    await saveTasks("2026-09-23", [task(CURRENT)]);
    const write = atomic.writeAtomic;
    const spy = vi.spyOn(atomic, "writeAtomic").mockImplementation((file, data) => {
      if (file.endsWith("2026-09-23.json")) return Promise.reject(new Error("source write failed"));
      return write(file, data);
    });
    await expect(rolloverTasks()).rejects.toThrow("source write failed");
    expect(getTasks("2026-09-24")).toHaveLength(1);
    expect(getTasks("2026-09-23")[0]?.movedAt).toBeUndefined();
    spy.mockRestore();

    expect(await rolloverTasks()).toHaveLength(1);
    expect(getTasks("2026-09-23")[0]?.movedToDate).toBe("2026-09-24");
    expect(getTasks("2026-09-24")[0]?.id).toBe(CURRENT);
  });

  it("does not resurrect a stale open snapshot after its newer snapshot was completed", async () => {
    await saveTasks("2026-09-22", [task(CURRENT)]);
    await saveTasks("2026-09-23", [task(CURRENT, { done: true, completedAt: "2026-09-23T17:00:00Z" })]);
    expect(await rolloverTasks()).toEqual([]);
    expect(getTasks("2026-09-22")[0]?.movedToDate).toBe("2026-09-23");
  });

  it("resolves prerequisites in both directions through old UUIDs and stable daily snapshots", async () => {
    const work = task(CURRENT, { rolledFromId: OLD, rolledFromDate: "2026-09-23" });
    const oldBlocker = task("blocker-old", { text: "Backend #prerequisite", movedAt: "2026-09-24T06:00:00Z" });
    const blocker = task("blocker", {
      text: "Backend #prerequisite", rolledFromId: oldBlocker.id, rolledFromDate: "2026-09-23",
      links: [{ kind: "task", id: OLD, label: "Work" }],
    });
    await saveTasks("2026-09-23", [task(OLD, { movedAt: "2026-09-24T06:00:00Z" }), oldBlocker]);
    await saveTasks("2026-09-24", [work, blocker]);
    const refs: Task["links"] = [{ kind: "task", id: oldBlocker.id, label: "Backend" }];
    expect(collectOpenPrerequisiteBlockers(CURRENT, refs).map((b) => b.id)).toEqual(["blocker"]);
    expect(collectOpenPrerequisiteBlockers(CURRENT, []).map((b) => b.id)).toEqual(["blocker"]);

    await saveTasks("2026-09-25", [work, { ...blocker, done: true }]);
    expect(collectOpenPrerequisiteBlockers(CURRENT, refs)).toEqual([]);
    const related = resolveEntityLinks("task", CURRENT);
    expect(related.related.filter((r) => r.id === "blocker")).toHaveLength(1);
    expect(related.taskAliases?.["blocker-old"]).toMatchObject({ id: "blocker", href: "/work?date=2026-09-25" });
  });
});
