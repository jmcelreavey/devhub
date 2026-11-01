import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TaskNoteView } from "../../../../../packages/shared/task-note/sections.ts";
import { cancelQaRun } from "../qa/service";
import { listRuns } from "../qa/store";
import type { Task } from "../../../../../packages/shared/tasks/types";
import { newAutoState } from "./auto-mode";
import { mutateOrchestration, newOrchestration, readOrchestration } from "./orchestration-store";
import { rerunOrchestrationStep, type OrchestratorDeps } from "./orchestrator";
import { managedPreviewForTask, stopPreview } from "./preview";

const taskId = "pre-pr-qa-task";
const taskDate = "2026-10-27";
const scenario = '## Verification\n```devhub-qa\n{"goals":[{"description":"Pinned result","assertion":"text","selector":"#result","expected":"Pinned checkout"}]}\n```';
let root: string;
let notes: string;
let checkout: string;
let task: Task;
let dependencies: OrchestratorDeps;
const request = { action: "rerun" as const, taskId, step: "qa" as const, idempotencyKey: "pre-pr-qa-request" };

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-pre-pr-qa-"));
  notes = path.join(root, "notes");
  checkout = path.join(root, "pinned");
  const otherCheckout = path.join(root, "other");
  const config = path.join(root, "upstarts", "fixture");
  for (const dir of [path.join(checkout, "dist"), path.join(otherCheckout, "dist"), config]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(checkout, "dist", "index.html"), '<h1 id="result">Pinned checkout</h1>');
  fs.writeFileSync(path.join(otherCheckout, "dist", "index.html"), '<h1 id="result">Wrong checkout</h1>');
  fs.writeFileSync(path.join(config, "preview.json"), JSON.stringify({ autoStart: true, kind: "static", directory: "dist" }));
  vi.stubEnv("UPSTARTS_DIR", path.join(root, "upstarts"));
  task = { id: taskId, text: "Show the pinned result", done: false, startDate: taskDate, createdAt: `${taskDate}T00:00:00.000Z`, rank: "a", links: [] };
  await mutateOrchestration(taskId, null, () => {
    const record = newOrchestration({ taskId, taskDate });
    record.status = "needs-you";
    record.executionStep = "draft-pr";
    record.repo = { name: "fixture", cwd: path.join(root, "other") };
    record.auto = {
      ...newAutoState("http://127.0.0.1"),
      phase: "draft-pr",
      work: { cwd: checkout },
      waiting: { kind: "failure", reason: "PR needs approval", at: new Date().toISOString() },
    };
    return record;
  }, notes);
  dependencies = {
    dispatch: vi.fn(async () => { throw new Error("QA must not dispatch an agent"); }),
    resolveRepos: vi.fn(async () => []),
    findTask: vi.fn(async () => task),
    auto: {
      noteView: () => ({ view: { questions: [] } as unknown as TaskNoteView, markdown: scenario, notePath: "" }),
      detectUi: async () => ({ detected: true, reason: "UI changed" }),
      taskRuns: () => [],
      activeHeavyJobs: () => 0,
      activeQaJobs: () => 0,
    },
  };
});

afterEach(() => {
  stopPreview(taskId);
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

it("runs QA on the pinned checkout without advancing a blocked PR", async () => {
  const result = await rerunOrchestrationStep(request, dependencies, notes);
  const run = listRuns(notes)[0];
  try {
    expect(result.execute).toBeDefined();
    expect(run).toMatchObject({ taskId, state: "running", taskAssertions: { goals: [{ expected: "Pinned checkout" }] } });
    const preview = managedPreviewForTask(taskId);
    expect(preview).not.toBeNull();
    expect(await (await fetch(preview!)).text()).toContain("Pinned checkout");
    expect(readOrchestration(taskId, notes)).toMatchObject({
      status: "needs-you", executionStep: "draft-pr", terminal: null,
      auto: { phase: "draft-pr", work: { cwd: checkout }, waiting: { kind: "failure", reason: "PR needs approval" } },
    });
    expect(dependencies.dispatch).not.toHaveBeenCalled();
    expect((await rerunOrchestrationStep(request, dependencies, notes)).execute).toBeUndefined();
    expect(listRuns(notes)).toHaveLength(1);
  } finally {
    if (run) cancelQaRun(run.id);
    if (result.execute) await result.execute();
  }
  expect(managedPreviewForTask(taskId)).toBeNull();
});

it("refuses QA without a pinned checkout or an opted-in scenario", async () => {
  await mutateOrchestration(taskId, null, (record) => {
    delete record!.auto!.work;
    return record;
  }, notes);
  await expect(rerunOrchestrationStep(request, dependencies, notes)).rejects.toThrow("pinned implementation checkout");
  await mutateOrchestration(taskId, null, (record) => {
    record!.auto!.work = { cwd: checkout };
    return record;
  }, notes);
  dependencies.auto!.noteView = () => ({ view: { questions: [] } as unknown as TaskNoteView, markdown: "## Verification", notePath: "" });
  await expect(rerunOrchestrationStep(request, dependencies, notes)).rejects.toThrow("add task-specific QA assertions");
  dependencies.auto!.noteView = () => ({ view: { questions: [] } as unknown as TaskNoteView, markdown: scenario, notePath: "" });
  dependencies.auto!.taskRuns = () => [{ runId: "active-agent", status: "running", startedAt: `${taskDate}T00:00:00.000Z` }];
  await expect(rerunOrchestrationStep(request, dependencies, notes)).rejects.toThrow("no longer idle");
  expect(listRuns(notes)).toHaveLength(0);
  expect(managedPreviewForTask(taskId)).toBeNull();
});

it("blocks the receipt if the task resumes before QA starts", async () => {
  const result = await rerunOrchestrationStep(request, dependencies, notes);
  await mutateOrchestration(taskId, null, (record) => {
    record!.status = "starting";
    return record;
  }, notes);
  await result.execute!();
  expect(listRuns(notes)[0].receipt).toMatchObject({ status: "blocked", stopReason: "The task or pinned checkout changed during QA. Run QA again." });
  expect(managedPreviewForTask(taskId)).toBeNull();
  expect(dependencies.dispatch).not.toHaveBeenCalled();
});
