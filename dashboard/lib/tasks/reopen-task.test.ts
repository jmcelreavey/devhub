import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addTask, abandonTask, setTaskCompletion } from "./storage";
import { reopenLogMessage, reopenTask } from "./reopen-task";
import { updateTaskNoteSections } from "./task-note-sections";
import { findTask, writeItem } from "@shared/tasks/store.ts";
import { mutateOrchestration, readOrchestration } from "@/lib/storyboard/orchestration-store";

vi.mock("@/lib/storage-server", async () => {
  const { NotesStorage } = await import("@/lib/storage");
  const { getNotesDir } = await import("@/lib/notes/dir");
  return { getStorage: () => new NotesStorage(getNotesDir()) };
});
vi.mock("@/lib/storyboard/orchestration-store", () => ({ readOrchestration: vi.fn(() => null), mutateOrchestration: vi.fn() }));
vi.mock("./task-agent-runs", () => ({ listTaskAgentRuns: () => [] }));

let root: string;
beforeEach(() => {
  vi.clearAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "reopen-task-"));
  vi.stubEnv("REPO_ROOT", root);
  vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
  vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

describe("reopenLogMessage", () => {
  it("leaves the time to the log entry", () => {
    expect(reopenLogMessage("  New   review comments ")).toBe("Reopened — New review comments");
    expect(reopenLogMessage()).toBe("Reopened");
    expect(reopenLogMessage("   ")).toBe("Reopened");
  });
});

describe("reopenTask", () => {
  it("rejects handed-off work before touching its orchestration or note", async () => {
    const task = await addTask("Handed off");
    updateTaskNoteSections({ taskId: task.id }, { op: "set_summary", text: "Keep this plan" });
    await setTaskCompletion(task.id, true);
    const directory = path.join(root, "tasks");
    writeItem(directory, { ...findTask(directory, task.id)!, handoff: { handoffId: "h1", toUserId: "U2", toName: "helper", status: "accepted", expiresAt: 1 } });
    const noteBefore = updateTaskNoteSections({ taskId: task.id }, { op: "read" }).view;
    await expect(reopenTask({ taskId: task.id })).rejects.toMatchObject({ status: 409 });
    expect(readOrchestration).not.toHaveBeenCalled();
    expect(mutateOrchestration).not.toHaveBeenCalled();
    expect(findTask(directory, task.id)?.done).toBe(true);
    expect(updateTaskNoteSections({ taskId: task.id }, { op: "read" }).view).toEqual(noteBefore);
  });
  it("keeps notes and history, and concurrently reopening adds exactly one log line", async () => {
    const task = await addTask("PTF-123 Fix feedback", "2026-10-18");
    updateTaskNoteSections({ taskId: task.id }, { op: "set_summary", text: "Keep this plan" });
    updateTaskNoteSections({ taskId: task.id }, { op: "add_decision", title: "Keep this decision", why: "Existing history" });
    await setTaskCompletion(task.id, true);
    const results = await Promise.all([reopenTask({ taskId: "PTF-123", reason: "Reviewer asked for changes" }), reopenTask({ taskId: task.id, reason: "Reviewer asked for changes" })]);
    expect(results.map((result) => result.alreadyOpen).sort()).toEqual([false, true]);
    expect(results[0].column).toBe("in-progress");
    const saved = findTask(path.join(root, "tasks"), task.id)!;
    expect(saved.done).toBe(false);
    expect(saved.completedAt).toBeUndefined();
    expect(saved.endDate).toBeUndefined();
    const view = updateTaskNoteSections({ taskId: task.id }, { op: "read" }).view;
    expect(JSON.stringify(view.summary)).toContain("Keep this plan");
    expect(JSON.stringify(view.decisions)).toContain("Keep this decision");
    expect(view.log.filter((item) => item.message.startsWith("Reopened"))).toHaveLength(1);
    expect(view.log[0].message).toBe("Reopened — Reviewer asked for changes");
    expect(view.meta?.status).toBe("in-progress");
  });
  it("reactivates abandoned tasks in Review when they have a PR", async () => {
    const task = await addTask("Fix", undefined, undefined, [{ kind: "pr", id: "acme/app#1", label: "PR", href: "https://github.com/acme/app/pull/1" }]);
    await abandonTask(task.id, "Old reason");
    const result = await reopenTask({ taskId: task.id });
    expect(result.column).toBe("ready-for-review");
    expect(result.task.abandonedAt).toBeUndefined();
    expect(result.task.abandonReason).toBeUndefined();
    expect(result.task.endDate).toBeUndefined();
  });
  it("creates a missing note but does not touch an already-open task", async () => {
    const task = await addTask("No note yet");
    expect((await reopenTask({ taskId: task.id })).alreadyOpen).toBe(true);
    await setTaskCompletion(task.id, true);
    expect((await reopenTask({ taskId: task.id })).column).not.toBe("todo");
    expect(updateTaskNoteSections({ taskId: task.id }, { op: "read" }).view.log).toHaveLength(1);
  });
  it("rejects missing tasks and stale profiles without writing anything", async () => {
    await expect(reopenTask({ taskId: "missing" })).rejects.toMatchObject({ status: 404 });
    await expect(reopenTask({ taskId: "missing", profile: "not-active" })).rejects.toMatchObject({ status: 409 });
  });
});
