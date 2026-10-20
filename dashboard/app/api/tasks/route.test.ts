import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "./route";
import { addTask, getTasks } from "@/lib/tasks/storage";
import type { TaskAgentRunRecord } from "@/lib/tasks/task-agent-runs";

const live = vi.hoisted(() => ({ runs: [] as TaskAgentRunRecord[], orchestration: null as { status: string } | null }));
vi.mock("@/lib/tasks/task-agent-runs", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/tasks/task-agent-runs")>(),
  listTaskAgentRuns: () => live.runs,
}));
vi.mock("@/lib/storyboard/orchestration-store", () => ({ readOrchestration: () => live.orchestration }));

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "task-completion-"));
  vi.stubEnv("REPO_ROOT", root);
  vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
  vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
  live.runs = [];
  live.orchestration = null;
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

function patch(body: Record<string, unknown>) {
  return PATCH(new Request("http://localhost/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}

describe("explicit task completion adapter", () => {
  it("completes once under concurrent requests, never toggles back, and has idempotent Undo", async () => {
    const task = await addTask("Finish a merged task");
    const responses = await Promise.all([patch({ id: task.id, completion: true }), patch({ id: task.id, completion: true })]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const completed = getTasks().find((item) => item.id === task.id)!;
    expect(completed.done).toBe(true);
    expect(completed.endDate).toBeDefined();
    expect((await (await patch({ id: task.id, completion: true })).json()).completedAt).toBe(completed.completedAt);
    await patch({ id: task.id, completion: false });
    await patch({ id: task.id, completion: false });
    expect(getTasks().find((item) => item.id === task.id)).toMatchObject({ done: false });
    expect(getTasks().find((item) => item.id === task.id)?.completedAt).toBeUndefined();
  });

  it.each([true, false])("preserves the legacy done=%s toggle semantics", async (done) => {
    const task = await addTask("Legacy client");
    expect((await (await patch({ id: task.id, done })).json()).done).toBe(true);
    expect((await (await patch({ id: task.id, done })).json()).done).toBe(false);
  });

  it.each(["queued", "running"] as const)("refuses Finish for a %s run, even when it isn't the latest run", async (status) => {
    const task = await addTask("Run still alive");
    live.runs = [
      { runId: "latest", status: "done", startedAt: "", updatedAt: "" },
      { runId: "older", status, startedAt: "", updatedAt: "" },
    ];
    const response = await patch({ id: task.id, completion: true });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("stop it before finishing") });
    expect(getTasks().find((item) => item.id === task.id)?.done).toBe(false);
  });

  it.each(["starting", "running"])("refuses Finish while auto is %s between runs", async (status) => {
    const task = await addTask("Auto still alive");
    live.orchestration = { status };
    expect((await patch({ id: task.id, completion: true })).status).toBe(409);
    expect(getTasks().find((item) => item.id === task.id)?.done).toBe(false);
  });

  it("validates the new field and still returns Not found for missing tasks", async () => {
    expect((await patch({ id: "missing", completion: "yes" })).status).toBe(400);
    expect((await patch({ id: "missing", completion: true })).status).toBe(404);
    expect((await patch({ id: "../invalid", completion: true })).status).toBe(400);
  });
});
