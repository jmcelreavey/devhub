import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TasksStorage } from "../../../mcp-servers/devhub-server/src/task-diagram-storage";
import { createTask, deletedDir, deleteTask, patchTask, readItems, tasksOnDay, writeItem } from "@shared/tasks/store.ts";
import { listTaskProfiles, resolveActiveTasksDir } from "@shared/vault/task-profiles.ts";
import { loadTaskIndex } from "./task-index";
import { getTasks, listTaskDays, listTaskFiles } from "./storage";
import { buildWeeklyReview } from "./weekly";

const GONE = "11111111-1111-4111-8111-111111111111";
const KEPT = "22222222-2222-4222-8222-222222222222";

let root: string;
let tasks: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-readers-"));
  tasks = path.join(root, "tasks");
  vi.stubEnv("REPO_ROOT", root);
  vi.stubEnv("TASKS_DIR", tasks);
  vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 8, 12, 0, 0));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("deleted tasks stay deleted for every reader", () => {
  it("hides a tombstoned task from Today, past days, history, weekly, the index and MCP", () => {
    createTask(tasks, { id: GONE, text: "Gone", startDate: "2026-10-06", createdAt: "2026-10-06T09:00:00.000Z" });
    createTask(tasks, { id: KEPT, text: "Kept", startDate: "2026-10-06", createdAt: "2026-10-06T09:00:00.000Z" });
    // A legacy id makes the delete leave a tombstone rather than just removing the file.
    const gone = readItems(tasks).find((task) => task.id === GONE)!;
    writeItem(tasks, { ...gone, legacyIds: ["legacy-gone"], legacyThrough: "2026-10-06" });
    expect(deleteTask(tasks, GONE)).toBe(true);
    expect(fs.existsSync(path.join(deletedDir(tasks), `${GONE}.json`))).toBe(true);

    const today = "2026-10-08";
    expect(getTasks(today).map((task) => task.id)).toEqual([KEPT]);
    expect(getTasks("2026-10-06").map((task) => task.id)).toEqual([KEPT]);
    const days = listTaskDays();
    expect(days.flatMap((day) => day.tasks.map((task) => task.id))).not.toContain(GONE);
    expect(listTaskFiles().reduce((total, day) => total + day.total, 0)).toBe(days.reduce((total, day) => total + day.tasks.length, 0));
    expect(JSON.stringify(buildWeeklyReview(days, today))).not.toContain(GONE);
    expect(loadTaskIndex().byId.has(GONE)).toBe(false);
    expect(loadTaskIndex().byId.has("legacy-gone")).toBe(false);

    const mcp = new TasksStorage(tasks, path.join(root, "notes"));
    expect(mcp.getDay(today).tasks.map((task) => task.id)).toEqual([KEPT]);
    expect(mcp.getDay("2026-10-06").tasks.map((task) => task.id)).toEqual([KEPT]);
    expect(mcp.list().reduce((total, day) => total + day.total, 0)).toBe(days.reduce((total, day) => total + day.tasks.length, 0));
  });
});

describe("reserved task directories", () => {
  it("never reads tasks/deleted, tasks/items or tasks/legacy as a profile", () => {
    for (const name of ["deleted", "items", "legacy"]) fs.mkdirSync(path.join(tasks, name), { recursive: true });
    expect(listTaskProfiles(tasks)).toEqual([]);
    expect(resolveActiveTasksDir(tasks)).toBe(tasks);
  });
});

describe("end dates use the local day", () => {
  it("completing at 00:30 local ends on the local day, not the UTC date", () => {
    createTask(tasks, { id: KEPT, text: "Late", startDate: "2026-10-07", createdAt: "2026-10-07T09:00:00.000Z" });
    const done = patchTask(tasks, KEPT, { status: "complete" }, new Date(2026, 9, 8, 0, 30, 0));
    expect(done?.endDate).toBe("2026-10-08");
    const abandoned = patchTask(tasks, KEPT, { status: "abandon" }, new Date(2026, 9, 8, 0, 30, 0));
    expect(abandoned?.endDate).toBe("2026-10-08");
    expect(tasksOnDay(tasks, "2026-10-08", "2026-10-08").map((task) => task.id)).toEqual([KEPT]);
  });
});
