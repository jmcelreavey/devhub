import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createTask, writeItem } from "../../domains/tasks/store";
import { NotesStorage } from "../../domains/storage/notes";
import { upsertTaskAgentRun } from "../../domains/tasks/task-agent-runs";
import { textToBlocks } from "../../../../../packages/shared/markdown-convert/index.ts";
import { mutateOrchestration, newOrchestration, readOrchestration, withOrchestrationMutationLock } from "../storyboard/orchestration-store";
import { newAutoState } from "../storyboard/auto-mode";
import { servicePlanFingerprint } from "./runtime-service-workflow";
import { runtimeServiceTaskOperation } from "./runtime-service-tasks";

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

async function fixture(kind: "plan" | "retry") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "service-dispatch-")); roots.push(root);
  const tasks = path.join(root, "tasks"), work = path.join(tasks, "work"), notes = path.join(root, "notes");
  fs.mkdirSync(work, { recursive: true }); fs.mkdirSync(path.join(tasks, "personal")); fs.mkdirSync(notes, { recursive: true });
  vi.stubEnv("TASKS_DIR", tasks); vi.stubEnv("NOTES_DIR", notes); vi.stubEnv("DEVHUB_CONFIG_DIR", path.join(root, "config")); vi.stubEnv("DEVHUB_PROFILE", "work");
  const task = createTask(work, { id: "task-one", text: "Fixture", createdAt: "2026-01-01T12:00:00Z" });
  const markdown = "# Fixture\n\n## Plan\n\nKeep the API stable.";
  await new NotesStorage(notes).write(`task-notes/${task.startDate}-${task.id}`, textToBlocks(markdown), null);
  const runId = "run-plan0001-0000000a";
  await upsertTaskAgentRun({ taskId: task.id, runId, status: kind === "plan" ? "done" : "failed", notesDir: notes });
  await mutateOrchestration(task.id, null, () => {
    const record = newOrchestration({ taskId: task.id, taskDate: task.startDate });
    record.status = "needs-you"; record.runIds = [runId];
    record.auto = { ...newAutoState("http://localhost:43200", true), runs: [{ runId, phase: "plan", round: 0, attempt: 0, at: new Date().toISOString() }], waiting: kind === "plan" ? { kind: "plan-approval", reason: "Review", at: new Date().toISOString() } : { kind: "failure", reason: "Failed", at: new Date().toISOString() } };
    return record;
  }, notes);
  return { task, work, notes, runId, markdown };
}

it("approves only the reviewed unchanged plan for the owned active task", async () => {
  const { task, work, notes, runId, markdown } = await fixture("plan");
  const request = { operation: "plan-approve", profile: "work", taskId: task.id, createdAt: task.createdAt, planRunId: runId, fingerprint: servicePlanFingerprint(runId, markdown), requestId: "request-approve-1" };
  await expect(runtimeServiceTaskOperation([], request)).rejects.toThrow(/reviewed/);
  await expect(runtimeServiceTaskOperation(["plan-approve"], { ...request, fingerprint: "0".repeat(64) })).rejects.toThrow(/changed/);
  await expect(runtimeServiceTaskOperation(["plan-approve"], { ...request, createdAt: "old" })).rejects.toThrow(/changed/);
  vi.stubEnv("DEVHUB_PROFILE", "personal");
  await expect(runtimeServiceTaskOperation(["plan-approve"], request)).rejects.toThrow(/changed/);
  vi.stubEnv("DEVHUB_PROFILE", "work");
  writeItem(work, { ...task, handoff: { handoffId: "hand-1", toUserId: "U1", toName: "Other", status: "pending", expiresAt: 1000 } });
  await expect(runtimeServiceTaskOperation(["plan-approve"], request)).rejects.toThrow(/changed/);
  writeItem(work, task);
  expect(await runtimeServiceTaskOperation(["plan-approve"], request)).toBeNull();
  expect(readOrchestration(task.id, notes)?.idempotency.some(entry => entry.key === request.requestId)).toBe(true);
});

it("rechecks the retry grant and task while waiting for the orchestration write", async () => {
  const { task, notes } = await fixture("retry");
  const request = { operation: "task-retry", profile: "work", taskId: task.id, createdAt: task.createdAt, requestId: "request-retry-1" };
  await expect(runtimeServiceTaskOperation([], request)).rejects.toThrow(/reviewed/);
  let release = () => {};
  let locked = false;
  const hold = withOrchestrationMutationLock(task.id, notes, async () => { locked = true; await new Promise<void>(resolve => { release = resolve; }); });
  await vi.waitFor(() => expect(locked).toBe(true));
  let allowed = true;
  const current = vi.fn(() => allowed);
  const pending = runtimeServiceTaskOperation(["task-retry"], request, current);
  const denied = expect(pending).rejects.toThrow(/authorisation|changed/);
  await vi.waitFor(() => expect(current.mock.calls.length).toBeGreaterThanOrEqual(3));
  allowed = false; release(); await hold; await denied;
  expect(readOrchestration(task.id, notes)?.auto?.waiting?.kind).toBe("failure");
  expect(await runtimeServiceTaskOperation(["task-retry"], request)).toBeNull();
  expect(readOrchestration(task.id, notes)?.idempotency.some(entry => entry.key === request.requestId)).toBe(true);
});
