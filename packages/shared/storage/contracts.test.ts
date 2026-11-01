import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { itemPath, timerPath } from "../tasks/paths.ts";
import { readTombstones, writeItem } from "../../../apps/core/src/domains/tasks/store.ts";
import { TaskConflictError, type TaskStorage } from "./contracts.ts";
import { createFileTaskStorage } from "../../../apps/core/src/domains/storage/file-tasks.ts";
import { taskDelete, taskUpdate } from "../actions/tasks.ts";

const directories: string[] = [];
const day = "2026-10-28";
const now = new Date(`${day}T10:00:00.000Z`);

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

// Run the same public contract against the SQLite adapter when it lands.
describe.each([{ name: "file", open: createFileTaskStorage }])("$name task storage", ({ open }) => {
  function fixture(): { directory: string; storage: TaskStorage } {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "task-storage-"));
    directories.push(directory);
    return { directory, storage: open(directory) };
  }

  it("round-trips fields, completion and history across reopen without creating notes", async () => {
    const { directory, storage } = fixture();
    const created = await storage.create({ text: "Keep the linked note", startDate: day, notePath: "task-notes/keep", due: day, stage: "draft", links: [{ kind: "jira", id: "DEV-42", label: "DEV-42" }] }, now);
    const patched = await storage.patch(created.id, { text: "Keep the updated note", status: "complete" }, now);
    expect(patched).toMatchObject({ id: created.id, done: true, completedAt: now.toISOString(), endDate: day, notePath: created.notePath, links: created.links, due: day, stage: "draft" });
    expect(await open(directory).find(created.id)).toEqual(patched);
    expect(await storage.listOpen(day)).toEqual([]);
    expect(await storage.listDays(day)).toEqual([{ date: day, tasks: [expect.objectContaining({ id: created.id, done: true })] }]);
    expect(fs.readdirSync(directory)).toEqual(["items"]);
    expect(await storage.patch(created.id, { status: "reactivate", due: null, stage: "ready", links: [] }, now)).toMatchObject({ done: false });
    const reopened = await storage.find(created.id);
    expect(reopened?.endDate).toBeUndefined();
    expect(reopened?.links).toBeUndefined();
    expect(reopened?.due).toBeUndefined();
    expect(reopened?.stage).toBeUndefined();
    expect(await storage.patch("missing", { text: "missing" })).toBeNull();
  });

  it("retains legacy tombstones and clears a deleted task's timer", async () => {
    const { directory, storage } = fixture();
    const task = await storage.create({ text: "Migrated", startDate: day }, now);
    writeItem(directory, { ...task, legacyIds: ["old-id"], legacyThrough: day });
    await storage.startTimer("old-id", now);
    expect(await storage.delete("old-id")).toBe(true);
    expect(await storage.find(task.id)).toBeNull();
    expect(await storage.delete(task.id)).toBe(false);
    expect(fs.existsSync(timerPath(directory))).toBe(false);
    expect(readTombstones(directory)).toEqual([{ id: task.id, deleted: true, legacyIds: [task.id, "old-id"].sort(), legacyThrough: day }]);
  });

  it("keeps task deletion scoped to the selected day and profile", async () => {
    const { directory, storage } = fixture();
    const other = fixture().storage;
    const task = await storage.create({ text: "Scoped", startDate: day }, now);
    const untouched = await other.create({ text: "Other profile", startDate: day }, now);
    writeItem(directory, { ...task, legacyIds: ["legacy-id"], legacyThrough: day });
    await storage.startTimer(task.id, now);
    const context = { storage: () => storage, prepare: async () => {}, today: () => day, scope: "day" as const };
    expect(await taskDelete.handler({ id: "legacy-id", date: "2026-10-27" }, context)).toEqual({ id: "legacy-id", deleted: false });
    expect(await storage.find(task.id)).not.toBeNull();
    expect(await taskDelete.handler({ id: "legacy-id", date: day }, context)).toEqual({ id: "legacy-id", deleted: true });
    expect(fs.existsSync(timerPath(directory))).toBe(false);
    expect(await other.find(untouched.id)).not.toBeNull();
    let active = storage;
    const afterMigration = { storage: () => active, prepare: async () => { active = other; }, today: () => day, scope: "all" as const };
    expect(await taskDelete.handler({ id: untouched.id, date: "2026-10-27" }, afterMigration)).toEqual({ id: untouched.id, deleted: true });
  });

  it("keeps action updates within the selected day and profile", async () => {
    const { directory, storage } = fixture();
    const other = fixture().storage;
    const task = await storage.create({ text: "Scoped", startDate: day }, now);
    const untouched = await other.create({ text: "Other profile", startDate: day }, now);
    writeItem(directory, { ...task, legacyIds: ["legacy-id"] });
    const context = {
      storage: () => storage,
      prepare: async () => {},
      today: () => day,
      scope: "day" as const,
      patch: (_task: typeof task, input: { text?: string }) => ({ text: input.text }),
      present: (current: typeof task) => current,
    };
    expect((await taskUpdate.handler({ id: "legacy-id", date: "2026-10-27", text: "Wrong day" }, context)).task).toBeNull();
    expect((await taskUpdate.handler({ id: untouched.id, date: day, text: "Wrong profile" }, context)).task).toBeNull();
    expect((await taskUpdate.handler({ id: "legacy-id", date: day, text: "Updated" }, context)).task?.text).toBe("Updated");
    expect((await other.find(untouched.id))?.text).toBe("Other profile");
  });

  it("serialises action toggles against the current task state", async () => {
    const { directory, storage } = fixture();
    const task = await storage.create({ text: "Toggle", startDate: day }, now);
    const context = {
      storage: () => open(directory),
      prepare: async () => {},
      today: () => day,
      scope: "all" as const,
      patch: (current: typeof task) => ({ status: current.done ? "reactivate" as const : "complete" as const }),
      present: (current: typeof task) => current,
    };
    await Promise.all([
      taskUpdate.handler({ id: task.id, done: true }, context),
      taskUpdate.handler({ id: task.id, done: true }, context),
    ]);
    expect((await storage.find(task.id))?.done).toBe(false);
  });

  it("settles a previous timer once and keeps running timers out of synced items", async () => {
    const { directory, storage } = fixture();
    const first = await storage.create({ text: "First", startDate: day }, now);
    const second = await storage.create({ text: "Second", startDate: day }, now);
    await storage.startTimer(first.id, now);
    await storage.startTimer(first.id, new Date(now.getTime() + 500));
    expect((await storage.onDay(day, day)).find((task) => task.id === first.id)?.timerStartedAt).toBe(now.toISOString());
    expect(JSON.parse(fs.readFileSync(itemPath(directory, first.id), "utf8")).timerStartedAt).toBeUndefined();
    await storage.startTimer(second.id, new Date(now.getTime() + 1_000));
    expect((await storage.find(first.id))?.timeSpentMs).toBe(1_000);
    await storage.stopTimer(second.id, new Date(now.getTime() + 3_000));
    await storage.stopTimer(second.id, new Date(now.getTime() + 4_000));
    expect((await open(directory).find(second.id))?.timeSpentMs).toBe(2_000);
    expect(fs.existsSync(timerPath(directory))).toBe(false);
  });

  it("serialises competing edits and rejects stale identity and content without overwriting", async () => {
    const { directory, storage } = fixture();
    const task = await storage.create({ text: "Original", startDate: day }, now);
    const competing = open(directory);
    const results = await Promise.allSettled([
      storage.patch(task.id, { text: "First edit" }, now, task),
      competing.patch(task.id, { text: "Stale edit" }, now, task),
    ]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1]).toMatchObject({ status: "rejected", reason: expect.any(TaskConflictError) });
    expect((await competing.find(task.id))?.text).toBe("First edit");
    await expect(storage.delete(task.id, task)).rejects.toBeInstanceOf(TaskConflictError);
    const current = (await storage.find(task.id))!;
    await expect(storage.patch(task.id, { text: "Wrong identity" }, now, { ...current, createdAt: "different" })).rejects.toBeInstanceOf(TaskConflictError);
    expect(await storage.delete(task.id, current)).toBe(true);
    await expect(storage.patch(task.id, { text: "Deleted" }, now, current)).rejects.toBeInstanceOf(TaskConflictError);
  });

  it("preserves ranks across concurrent creates and rejects incomplete or repeated ordering", async () => {
    const { directory, storage } = fixture();
    const [first, second] = await Promise.all([
      storage.create({ text: "First", startDate: day }, now),
      open(directory).create({ text: "Second", startDate: day }, now),
    ]);
    expect(first.rank).not.toBe(second.rank);
    await storage.reorder([second.id, first.id], day, day);
    expect((await open(directory).onDay(day, day)).map((task) => task.id)).toEqual([second.id, first.id]);
    await expect(storage.reorder([first.id], day, day)).rejects.toThrow("every open task exactly once");
    await expect(storage.reorder([first.id, first.id], day, day)).rejects.toThrow("every open task exactly once");
    expect((await storage.onDay(day, day)).map((task) => task.id)).toEqual([second.id, first.id]);
    expect(await storage.readErrors()).toEqual([]);
  });

  it("keeps compound reads and writes together and releases a rejected scope", async () => {
    const { directory, storage } = fixture();
    const task = await storage.create({ text: "Compound update", startDate: day }, now);
    const increment = () => open(directory).withWriteLock(async (scope) => {
      const current = (await scope.find(task.id))!;
      await scope.patch(task.id, { timeSpentMs: (current.timeSpentMs ?? 0) + 1 });
    });
    await Promise.all([increment(), increment()]);
    expect((await storage.find(task.id))?.timeSpentMs).toBe(2);
    await expect(storage.withWriteLock(async () => { throw new Error("Check rejected"); })).rejects.toThrow("Check rejected");
    expect(await storage.patch(task.id, { text: "Queue released" })).toMatchObject({ text: "Queue released" });
  });
});
