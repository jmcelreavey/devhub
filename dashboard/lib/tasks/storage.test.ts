import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpRepo: string;
let originalRepoRoot: string | undefined;
let originalTasksDir: string | undefined;

async function freshTaskModule() {
  // Clear module cache so getRepoRoot picks up the new env value
  // (Vitest's vi.resetModules requires importing it; doing it manually keeps the test simple.)
  const url = new URL("./storage.ts", import.meta.url).href + `?t=${Date.now()}`;
  return await import(url);
}

beforeEach(() => {
  tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-tasks-"));
  originalRepoRoot = process.env.REPO_ROOT;
  originalTasksDir = process.env.TASKS_DIR;
  process.env.REPO_ROOT = tmpRepo;
  process.env.TASKS_DIR = path.join(tmpRepo, "tasks");
});

afterEach(() => {
  if (originalRepoRoot === undefined) delete process.env.REPO_ROOT;
  else process.env.REPO_ROOT = originalRepoRoot;
  if (originalTasksDir === undefined) delete process.env.TASKS_DIR;
  else process.env.TASKS_DIR = originalTasksDir;
});


function localDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

describe("tasks-storage", () => {
  it("addTask + getTasks round trip", async () => {
    const m = await freshTaskModule();
    const t = await m.addTask("Pick up milk");
    expect(t.text).toBe("Pick up milk");
    const tasks = m.getTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe(t.id);
  });

  it("extracts Jira keys from text", async () => {
    const m = await freshTaskModule();
    const t = await m.addTask("Look at FOO-123 today");
    expect(t.jiraKey).toBe("FOO-123");
  });

  it("toggleTask flips done state", async () => {
    const m = await freshTaskModule();
    const t = await m.addTask("x");
    const toggled = await m.toggleTask(t.id);
    expect(toggled.done).toBe(true);
    expect(toggled.completedAt).toBeDefined();
  });

  it("deleteTask removes the task", async () => {
    const m = await freshTaskModule();
    const t = await m.addTask("x");
    expect(await m.deleteTask(t.id)).toBe(true);
    expect(m.getTasks()).toHaveLength(0);
  });

  it("concurrent adds do not lose tasks (atomic write serializes)", async () => {
    const m = await freshTaskModule();
    const created = await Promise.all(
      Array.from({ length: 10 }, (_, i) => m.addTask(`task ${i}`)),
    );
    const tasks = m.getTasks();
    expect(tasks).toHaveLength(10);
    const ids = new Set(tasks.map((t: { id: string }) => t.id));
    for (const c of created) {
      expect(ids.has(c.id)).toBe(true);
    }
  });

  it("updateTask sets due", async () => {
    const m = await freshTaskModule();
    const t = await m.addTask("x");
    const updated = await m.updateTask(t.id, { due: "2026-05-09" });
    expect(updated.due).toBe("2026-05-09");
  });

  it("updateTask promotes a jira link into text/jiraKey when unset", async () => {
    const m = await freshTaskModule();
    const t = await m.addTask("Ship the thing");
    expect(t.jiraKey).toBeUndefined();
    const updated = await m.updateTask(t.id, {
      links: [{ kind: "jira", id: "FOO-42", label: "FOO-42" }],
    });
    expect(updated?.links).toEqual([{ kind: "jira", id: "FOO-42", label: "FOO-42" }]);
    expect(updated?.jiraKey).toBe("FOO-42");
    expect(updated?.text).toBe("FOO-42 Ship the thing");
  });

  it("updateTask does not change an existing jiraKey when adding links", async () => {
    const m = await freshTaskModule();
    const t = await m.addTask("BAR-1 already associated");
    expect(t.jiraKey).toBe("BAR-1");
    const updated = await m.updateTask(t.id, {
      links: [{ kind: "jira", id: "ZZZ-9", label: "ZZZ-9" }],
    });
    expect(updated?.jiraKey).toBe("BAR-1");
    expect(updated?.text).toBe("BAR-1 already associated");
  });

  it("updateTask clears links when patched to an empty array", async () => {
    const m = await freshTaskModule();
    const t = await m.addTask("with link");
    await m.updateTask(t.id, {
      links: [{ kind: "pr", id: "org/repo#1", label: "PR" }],
    });
    const cleared = await m.updateTask(t.id, { links: [] });
    expect(cleared?.links).toBeUndefined();
    expect(cleared?.text).toBe("with link");
  });

  it("reorderOpenTasks persists open task order without moving completed tasks", async () => {
    const m = await freshTaskModule();
    const one = await m.addTask("one");
    const two = await m.addTask("two");
    const three = await m.addTask("three");
    await m.toggleTask(two.id);

    const reordered = await m.reorderOpenTasks([three.id, one.id]);
    expect(reordered.map((t: { text: string }) => t.text)).toEqual(["three", "one", "two"]);
    expect(m.getTasks().map((t: { text: string }) => t.text)).toEqual(["three", "one", "two"]);
  });

  it("reorderOpenTasks rejects incomplete open task orders", async () => {
    const m = await freshTaskModule();
    const one = await m.addTask("one");
    await m.addTask("two");
    await expect(m.reorderOpenTasks([one.id])).rejects.toThrow("every open task");
  });

  it("reorderOpenTasks rejects duplicate ids", async () => {
    const m = await freshTaskModule();
    const one = await m.addTask("one");
    await m.addTask("two");
    await expect(m.reorderOpenTasks([one.id, one.id])).rejects.toThrow("every open task");
  });

  it("abandonTask marks a task as abandoned", async () => {
    const m = await freshTaskModule();
    const t = await m.addTask("x");
    const abandoned = await m.abandonTask(t.id, "not needed");
    expect(abandoned.abandonedAt).toBeDefined();
    expect(abandoned.abandonReason).toBe("not needed");
    expect(abandoned.done).toBe(false);
    expect(abandoned.completedAt).toBeUndefined();
  });

  it("abandonTask without reason stores no reason", async () => {
    const m = await freshTaskModule();
    const t = await m.addTask("x");
    const abandoned = await m.abandonTask(t.id);
    expect(abandoned.abandonedAt).toBeDefined();
    expect(abandoned.abandonReason).toBeUndefined();
  });

  it("toggleTask clears abandoned fields when completing", async () => {
    const m = await freshTaskModule();
    const t = await m.addTask("x");
    await m.abandonTask(t.id, "reason");
    const toggled = await m.toggleTask(t.id);
    expect(toggled.done).toBe(true);
    expect(toggled.abandonedAt).toBeUndefined();
    expect(toggled.abandonReason).toBeUndefined();
  });

  it("keeps an open task on today and leaves an abandoned one behind", async () => {
    const m = await freshTaskModule();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yDate = localDay(yesterday);
    const active = await m.addTask("active task", yDate);
    const dropped = await m.addTask("will abandon", yDate);
    await m.abandonTask(dropped.id, "skip");
    const today = m.getTasks();
    const abandoned = today.find((task: { id: string }) => task.id === dropped.id);
    const stillOpen = today.find((task: { id: string }) => task.id === active.id);
    expect(m.isTaskOpen(stillOpen)).toBe(true);
    expect(abandoned?.abandonedAt).toBeTruthy();
    expect(m.isTaskOpen(abandoned)).toBe(false);
    expect(m.getTasks(yDate).map((task: { id: string }) => task.id).sort()).toEqual([active.id, dropped.id].sort());
  });

  it("still shows a task that started before yesterday", async () => {
    const m = await freshTaskModule();
    const stale = new Date();
    stale.setDate(stale.getDate() - 3);
    const staleDate = localDay(stale);
    await m.addTask("stale open task", staleDate);
    await m.addTask("another stale task", staleDate);
    expect(m.getTasks().map((task: { text: string }) => task.text).sort()).toEqual(["another stale task", "stale open task"]);
    const earlier = m.getTasks(staleDate);
    expect(earlier).toHaveLength(2);
    expect(earlier.every((task: { done: boolean; endDate?: string }) => m.isTaskOpen(task))).toBe(true);
  });

  it("keeps the same task when it is still open the next day", async () => {
    const m = await freshTaskModule();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const source = await m.addTask("carry over", localDay(yesterday));
    const today = m.getTasks();
    expect(today).toHaveLength(1);
    expect(today[0]).toMatchObject({ id: source.id, text: "carry over", createdAt: source.createdAt, notePath: source.notePath });
    expect(m.isTaskOpen(today[0])).toBe(true);
  });

  it("shows an older open task beside one added today", async () => {
    const m = await freshTaskModule();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await m.addTask("carry over", localDay(yesterday));
    await m.addTask("added today");
    expect(m.getTasks().map((task: { text: string }) => task.text).sort()).toEqual(["added today", "carry over"]);
  });

  it("does not bring a deleted task back", async () => {
    const m = await freshTaskModule();
    const task = await m.addTask("gone");
    expect(await m.deleteTask(task.id)).toBe(true);
    expect(m.getTasks()).toEqual([]);
    expect(await m.deleteTask(task.id)).toBe(false);
  });

  it("isTaskOpen excludes done, abandoned, and ended tasks", async () => {
    const m = await freshTaskModule();
    const base = { id: "1", text: "x", done: false, startDate: "2026-10-01", rank: "1", createdAt: "" };
    expect(m.isTaskOpen(base)).toBe(true);
    expect(m.isTaskOpen({ ...base, done: true })).toBe(false);
    expect(m.isTaskOpen({ ...base, abandonedAt: "t" })).toBe(false);
    expect(m.isTaskOpen({ ...base, endDate: "2026-10-02" })).toBe(false);
  });
});
