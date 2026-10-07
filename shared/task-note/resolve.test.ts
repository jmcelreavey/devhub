import { describe, expect, it } from "vitest";
import type { Task } from "../tasks/types.ts";
import { taskNotePath } from "./index.ts";
import { resolveStoredTaskNotes } from "./resolve.ts";

const old: Task = { id: "old", text: "Plan", done: false, createdAt: "2026-09-23T09:00:00Z" };
const current: Task = { ...old, id: "current", rolledFromId: "old", rolledFromDate: "2026-09-23" };
const oldPath = "task-notes/2026-09-23-old";
const currentPath = "task-notes/2026-09-24-current";

describe("legacy task note resolution", () => {
  it("keeps the newest plan primary and older notes reachable without modifying them", () => {
    const result = resolveStoredTaskNotes(current, "2026-09-24", {
      readTask: () => old,
      noteExists: (p) => [oldPath, currentPath].includes(p),
    });
    expect(result).toEqual({ notePath: currentPath, previousNotePaths: [oldPath] });
  });

  it("pins a single path even before the note exists", () => {
    const result = resolveStoredTaskNotes({ ...current, notePath: oldPath }, "2026-09-25", {
      readTask: () => old,
      noteExists: () => false,
    });
    expect(result.notePath).toBe(oldPath);
    expect(taskNotePath({ ...current, date: "2026-09-26", notePath: result.notePath })).toBe(oldPath);
  });

  it("stops on cycles in legacy lineage", () => {
    const result = resolveStoredTaskNotes(current, "2026-09-24", {
      readTask: () => ({ ...old, rolledFromId: "old", rolledFromDate: "2026-09-23" }),
      noteExists: () => false,
    });
    expect(result.notePath).toBe(oldPath);
  });

  it("rejects a stored note path that escapes task-notes", () => {
    expect(() => taskNotePath({ ...current, date: "2026-09-24", notePath: "task-notes/../../secret" }))
      .toThrow("Invalid task note path");
    expect(() => taskNotePath({ ...current, id: "../secret", date: "2026-09-24" }))
      .toThrow("Invalid task note id");
  });

  it("does not read an invalid legacy date as a filesystem path", () => {
    const result = resolveStoredTaskNotes({ ...current, rolledFromDate: "../secret" }, "2026-09-24", {
      readTask: () => { throw new Error("must not read"); },
      noteExists: () => false,
    });
    expect(result.notePath).toBe(currentPath);
  });
});
