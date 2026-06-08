import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpRepo: string;
let originalRepoRoot: string | undefined;

async function freshTaskModule() {
  // Clear module cache so getRepoRoot picks up the new env value
  // (Vitest's vi.resetModules requires importing it; doing it manually keeps the test simple.)
  const url = new URL("./tasks-storage.ts", import.meta.url).href + `?t=${Date.now()}`;
  return await import(url);
}

beforeEach(() => {
  tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-tasks-"));
  originalRepoRoot = process.env.REPO_ROOT;
  process.env.REPO_ROOT = tmpRepo;
});

afterEach(() => {
  if (originalRepoRoot === undefined) delete process.env.REPO_ROOT;
  else process.env.REPO_ROOT = originalRepoRoot;
});

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

  it("reorderOpenTasks persists open task order without moving completed tasks", async () => {
    const m = await freshTaskModule();
    const one = await m.addTask("one");
    const two = await m.addTask("two");
    const three = await m.addTask("three");
    await m.toggleTask(two.id);

    const reordered = await m.reorderOpenTasks([three.id, one.id]);
    expect(reordered.map((t: { text: string }) => t.text)).toEqual(["three", "two", "one"]);
    expect(m.getTasks().map((t: { text: string }) => t.text)).toEqual(["three", "two", "one"]);
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

  it("rollover excludes abandoned tasks", async () => {
    const m = await freshTaskModule();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yDate = yesterday.toISOString().split("T")[0];
    const a = await m.addTask("active task", yDate);
    await m.addTask("will abandon", yDate);
    const tasks = m.getTasks(yDate);
    const toAbandon = tasks.find((t: { id: string }) => t.id !== a.id);
    await m.abandonTask(toAbandon.id, "skip", yDate);
    const rolled = await m.rolloverTasks();
    expect(rolled).toHaveLength(1);
    expect(rolled[0].text).toBe("active task");
  });

  it("rollover catches up open tasks from days before yesterday", async () => {
    const m = await freshTaskModule();
    const stale = new Date();
    stale.setDate(stale.getDate() - 3);
    const staleDate = stale.toISOString().split("T")[0];
    await m.addTask("stale open task", staleDate);
    await m.addTask("another stale task", staleDate);

    const rolled = await m.rolloverTasks();
    expect(rolled).toHaveLength(2);
    expect(rolled.map((t: { text: string }) => t.text).sort()).toEqual(
      ["another stale task", "stale open task"].sort(),
    );

    const staleTasks = m.getTasks(staleDate);
    expect(staleTasks.every((t: { movedAt?: string }) => !!t.movedAt)).toBe(true);
    expect(m.isTaskOpen(staleTasks[0]!)).toBe(false);
  });

  it("rollover marks yesterday tasks moved and copies to today", async () => {
    const m = await freshTaskModule();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yDate = yesterday.toISOString().split("T")[0];
    const source = await m.addTask("carry over", yDate);
    const rolled = await m.rolloverTasks();
    expect(rolled).toHaveLength(1);
    expect(rolled[0].text).toBe("carry over");
    expect(rolled[0].id).not.toBe(source.id);
    expect(rolled[0].movedAt).toBeUndefined();
    expect(rolled[0].movedToDate).toBeUndefined();

    const yesterdayTasks = m.getTasks(yDate);
    const movedSource = yesterdayTasks.find((t: { id: string }) => t.id === source.id);
    expect(movedSource?.movedAt).toBeDefined();
    expect(movedSource?.movedToDate).toBeDefined();
    expect(m.isTaskOpen(movedSource!)).toBe(false);
  });

  it("rollover merges into today when today's file already exists", async () => {
    const m = await freshTaskModule();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yDate = yesterday.toISOString().split("T")[0];
    await m.addTask("carry over", yDate);
    await m.addTask("added before rollover");

    const rolled = await m.rolloverTasks();
    const today = new Date().toISOString().split("T")[0];
    const todayTasks = m.getTasks(today);

    expect(rolled).toHaveLength(2);
    expect(todayTasks).toHaveLength(2);
    expect(todayTasks.map((t: { text: string }) => t.text).sort()).toEqual(
      ["added before rollover", "carry over"].sort(),
    );
  });

  it("rollover does not duplicate tasks after a partial write (crash recovery)", async () => {
    const m = await freshTaskModule();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yDate = yesterday.toISOString().split("T")[0];
    const today = new Date().toISOString().split("T")[0];
    const source = await m.addTask("carry over", yDate);

    const rolledId = crypto.randomUUID();
    const now = new Date().toISOString();
    await m.saveTasks(today, [
      {
        id: rolledId,
        text: "carry over",
        done: false,
        createdAt: now,
        rolledFromId: source.id,
        rolledFromDate: yDate,
      },
    ]);

    const rolled = await m.rolloverTasks();
    expect(rolled).toHaveLength(1);
    expect(rolled[0].id).toBe(rolledId);
    expect(m.getTasks(today)).toHaveLength(1);

    const movedSource = m.getTasks(yDate).find((t: { id: string }) => t.id === source.id);
    expect(m.isTaskOpen(movedSource!)).toBe(false);
  });

  it("rollover leaves yesterday tasks open when today's save fails", async () => {
    const m = await freshTaskModule();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yDate = yesterday.toISOString().split("T")[0];
    const source = await m.addTask("carry over", yDate);

    const tasksDir = path.join(tmpRepo, "tasks");
    fs.chmodSync(tasksDir, 0o555);

    await expect(m.rolloverTasks()).rejects.toThrow();
    fs.chmodSync(tasksDir, 0o755);

    const yesterdayTasks = m.getTasks(yDate);
    const openSource = yesterdayTasks.find((t: { id: string }) => t.id === source.id);
    expect(m.isTaskOpen(openSource!)).toBe(true);
    expect(openSource?.movedAt).toBeUndefined();

    const today = new Date().toISOString().split("T")[0];
    expect(m.getTasks(today)).toHaveLength(0);

    const rolled = await m.rolloverTasks();
    expect(rolled).toHaveLength(1);
    expect(rolled[0].text).toBe("carry over");
    expect(m.isTaskOpen(m.getTasks(yDate).find((t: { id: string }) => t.id === source.id)!)).toBe(
      false,
    );
  });

  it("concurrent rolloverTasks does not overwrite today's file", async () => {
    const m = await freshTaskModule();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yDate = yesterday.toISOString().split("T")[0];
    await m.addTask("one", yDate);
    await m.addTask("two", yDate);
    await m.addTask("three", yDate);

    const [a, b] = await Promise.all([m.rolloverTasks(), m.rolloverTasks()]);
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(3);
    expect(b).toEqual(a);
    const today = new Date().toISOString().split("T")[0];
    const todayTasks = m.getTasks(today);
    expect(todayTasks).toHaveLength(3);
    expect(todayTasks).toEqual(a);
  });

  it("isTaskOpen excludes done, abandoned, and moved", async () => {
    const m = await freshTaskModule();
    expect(m.isTaskOpen({ id: "1", text: "x", done: false, createdAt: "" })).toBe(true);
    expect(m.isTaskOpen({ id: "1", text: "x", done: true, createdAt: "" })).toBe(false);
    expect(m.isTaskOpen({ id: "1", text: "x", done: false, createdAt: "", abandonedAt: "t" })).toBe(false);
    expect(m.isTaskOpen({ id: "1", text: "x", done: false, createdAt: "", movedAt: "t" })).toBe(false);
  });
});
