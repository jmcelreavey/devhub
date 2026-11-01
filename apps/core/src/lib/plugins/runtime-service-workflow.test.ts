import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createTask, findTask, withTaskLock, writeItem } from "../../domains/tasks/store";
import { NotesStorage } from "../../domains/storage/notes";
import { blocksToText, textToBlocks } from "../../../../../packages/shared/markdown-convert/index.ts";
import { mutateOrchestration, newOrchestration } from "../storyboard/orchestration-store";
import { serviceWorkflowOperation } from "./runtime-service-workflow";
import { tryAcquireProcessDirectoryLock } from "../../../../../packages/shared/process/directory-lock.ts";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "service-workflow-")));
  roots.push(root);
  const directory = path.join(root, "tasks");
  const notes = path.join(root, "notes");
  fs.mkdirSync(directory);
  fs.mkdirSync(notes);
  vi.stubEnv("NOTES_DIR", notes);
  const task = createTask(directory, { id: "task-1", text: "Fixture task", createdAt: "2026-01-01T12:00:00.000Z" });
  return { directory, notes, task };
}

it("reads the current task state only while the service is authorised and owns the task", async () => {
  const { directory, notes, task } = fixture();
  const request = { operation: "workflow-state" as const, profile: "work", taskId: task.id, createdAt: task.createdAt };
  expect(await serviceWorkflowOperation(request, directory, directory, () => true)).toEqual({ kind: "idle" });
  await mutateOrchestration(task.id, null, () => newOrchestration({ taskId: task.id, taskDate: task.startDate }), notes);
  expect(await serviceWorkflowOperation(request, directory, directory, () => true)).toEqual({ kind: "running" });
  await expect(serviceWorkflowOperation(request, directory, directory, () => false)).rejects.toThrow(/authorisation/);
  writeItem(directory, { ...findTask(directory, task.id)!, done: true });
  await expect(serviceWorkflowOperation(request, directory, directory, () => true)).rejects.toThrow(/no longer available/);
});

it("appends feedback only after rechecking authorisation and ownership under the task lock", async () => {
  const { directory, notes, task } = fixture();
  const request = { operation: "workflow-note" as const, profile: "work", taskId: task.id, createdAt: task.createdAt, line: "Feedback from the thread" };
  expect(await serviceWorkflowOperation(request, directory, directory, () => true)).toBeNull();
  const note = new NotesStorage(notes).read(`task-notes/${task.startDate}-${task.id}`);
  expect(blocksToText(note!.content as unknown[])).toContain(request.line);
  const defaultRelease = () => {};
  let release = defaultRelease;
  const held = withTaskLock(directory, () => new Promise<void>((resolve) => { release = resolve; }));
  await vi.waitFor(() => expect(release).not.toBe(defaultRelease));
  let authorised = true;
  const pending = serviceWorkflowOperation({ ...request, line: "Must not be written" }, directory, directory, () => authorised);
  const denied = expect(pending).rejects.toThrow(/authorisation/);
  authorised = false;
  release();
  await held;
  await denied;
  const unlockContent = tryAcquireProcessDirectoryLock(path.join(notes, ".content-write.lock"));
  if (!unlockContent) throw new Error("Could not lock fixture content");
  authorised = true;
  const current = vi.fn(() => authorised);
  const waiting = serviceWorkflowOperation({ ...request, line: "Cancelled while waiting" }, directory, directory, current);
  const rejected = expect(waiting).rejects.toThrow(/authorisation/);
  await vi.waitFor(() => expect(current).toHaveBeenCalledTimes(1));
  authorised = false;
  unlockContent();
  await rejected;
  const heldContent = tryAcquireProcessDirectoryLock(path.join(notes, ".content-write.lock"));
  if (!heldContent) throw new Error("Could not lock fixture content");
  const checked = vi.fn(() => true);
  const interrupted = serviceWorkflowOperation({ ...request, line: "Task handed off while waiting" }, directory, directory, checked);
  const stale = expect(interrupted).rejects.toThrow(/task changed/i);
  await vi.waitFor(() => expect(checked).toHaveBeenCalledTimes(1));
  writeItem(directory, { ...findTask(directory, task.id)!, handoff: { handoffId: "handoff-1", toUserId: "U1", toName: "Other", status: "pending", expiresAt: 1 } });
  heldContent();
  await stale;
  await expect(serviceWorkflowOperation(request, directory, directory, () => true)).rejects.toThrow(/no longer available/);
  expect(blocksToText(new NotesStorage(notes).read(`task-notes/${task.startDate}-${task.id}`)!.content as unknown[])).not.toContain("Must not be written");
  expect(blocksToText(new NotesStorage(notes).read(`task-notes/${task.startDate}-${task.id}`)!.content as unknown[])).not.toContain("Cancelled while waiting");
  expect(blocksToText(new NotesStorage(notes).read(`task-notes/${task.startDate}-${task.id}`)!.content as unknown[])).not.toContain("Task handed off while waiting");
});

it("accepts a legacy task note path ending in .json", async () => {
  const { directory, notes, task } = fixture();
  const notePath = `task-notes/${task.startDate}-${task.id}`;
  writeItem(directory, { ...task, notePath: notePath + ".json" });
  const storage = new NotesStorage(notes);
  await storage.write(notePath, textToBlocks("# Fixture\n\n## Log\n"), null);
  await serviceWorkflowOperation({ operation: "workflow-note", profile: "work", taskId: task.id, createdAt: task.createdAt, line: "Legacy feedback" }, directory, directory, () => true);
  expect(blocksToText(storage.read(notePath)!.content as unknown[])).toContain("Legacy feedback");
});
