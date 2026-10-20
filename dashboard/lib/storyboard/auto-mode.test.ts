import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/paseo/client", () => ({ withPaseo: vi.fn(), openPaseoSession: vi.fn(), paseoUrl: vi.fn() }));

import type { AgentRun } from "@/lib/agent-runs/store";
import type { TaskAgentRunStatus } from "@/lib/tasks/task-agent-runs";
import type { Task } from "@/lib/tasks/types";
import type { TaskNoteView } from "@shared/task-note/sections.ts";
import { advanceAuto, askBackAuto, newAutoState, rerunVerification, retryAuto, setUiOverride, type AutoDeps } from "./auto-mode";
import { deleteOrchestration, mutateOrchestration, newOrchestration, readOrchestration } from "./orchestration-store";
import type { OrchestrationRecord } from "./types";
import { DEFAULT_MODEL_TIERS } from "./model-tiers-shared";

const TASK_ID = "aaaaaaaa-1111-2222-3333-444444444444";
let root: string;
let notes: string;

const task: Task = { id: TASK_ID, text: "Fix the sidebar layout", done: false, createdAt: "", startDate: "2026-10-17", rank: "a", links: [{ kind: "repo", id: "org/app", label: "app" }] } as Task;

interface World {
  runs: Map<string, TaskAgentRunStatus>;
  byRequest: Map<string, string>;
  qa: Map<string, { finished: boolean; bugs: number }>;
  questions: Array<{ id: string; text: string; resolved: boolean }>;
  bugs: Array<{ id: string; status: "open" | "fixed" | "wontfix"; title: string }>;
  noteStatuses: string[];
  heavy: number;
  qaJobs: number;
  dispatched: Array<{ requestId?: string; action?: string; tier?: string; tierReason?: string; prompt: string }>;
  failDispatch?: string;
  ui: boolean;
  url: string | null;
}

function world(patch: Partial<World> = {}): World {
  return { runs: new Map(), byRequest: new Map(), qa: new Map(), questions: [], bugs: [], noteStatuses: [], heavy: 0, qaJobs: 0, dispatched: [], ui: true, url: "http://localhost:3000", ...patch };
}

function view(w: World): TaskNoteView {
  return { title: task.text, meta: null, hasMeta: false, summary: [], statusText: [], questions: w.questions, decisions: [], userNotes: [], media: [], bugs: w.bugs, poi: [], waypoints: [], log: [], other: {}, freeformCount: 0 } as TaskNoteView;
}

function deps(w: World, patch: Partial<AutoDeps> = {}): AutoDeps {
  let runCounter = 0;
  let qaCounter = 0;
  return {
    dispatch: vi.fn(async (input) => {
      if (w.failDispatch) throw new Error(w.failDispatch);
      w.dispatched.push({ requestId: input.requestId, action: input.activity?.action, tier: input.tier, tierReason: input.tierReason, prompt: input.prompt });
      // Same request ID, same run: what makes a lost write safe to replay.
      const existing = input.requestId ? w.byRequest.get(input.requestId) : undefined;
      const id = existing ?? `run-auto${String(++runCounter).padStart(4, "0")}-0000000a`;
      if (input.requestId) w.byRequest.set(input.requestId, id);
      if (!w.runs.has(id)) w.runs.set(id, "running");
      return { spec: { id } } as unknown as AgentRun;
    }),
    findTask: vi.fn(async () => task),
    noteView: () => ({ view: view(w), markdown: "## Plan\n- app/sidebar.tsx", notePath: `task-notes/2026-10-17-${TASK_ID}` }),
    runStatus: (_taskId, runId) => w.runs.get(runId),
    runWork: () => ({ cwd: "/repo/app" }),
    prepareTaskQa: vi.fn((input) => {
      const id = `qa-${++qaCounter}${input.baseline ? "-baseline" : ""}`;
      w.qa.set(id, { finished: false, bugs: 0 });
      return { skipped: false as const, run: { id } as never, execute: async () => undefined };
    }),
    qaResult: async (id) => {
      const result = w.qa.get(id);
      return result ? { ...result, failing: result.bugs ? ["sidebar overlaps the board failed"] : [] } : null;
    },
    activeHeavyJobs: () => w.heavy,
    activeQaJobs: () => w.qaJobs,
    setNoteStatus: (_task, _date, status) => { w.noteStatuses.push(status); },
    chooseCheckout: async () => ({ mode: "checkout", reason: "clean", decidedAt: new Date().toISOString() }),
    cancelRun: vi.fn(async () => "signalled"),
    detectUi: async () => ({ detected: w.ui, reason: w.ui ? "touches app/sidebar.tsx" : "no UI files" }),
    pickTier: async () => ({}),
    resolvePreview: async () => (w.url ? { url: w.url, state: "url" as const, reason: "Preview URL from the task." } : { url: null, state: "none" as const, reason: "The task has no preview URL." }),
    stopPreview: vi.fn(),
    ...patch,
  };
}

async function seed(patch: (record: OrchestrationRecord) => void = () => undefined): Promise<void> {
  await mutateOrchestration(TASK_ID, null, () => {
    const record = newOrchestration({ taskId: TASK_ID, taskDate: "2026-10-17" });
    record.status = "running";
    record.repo = { name: "org/app", cwd: "/repo/app" };
    record.auto = { ...newAutoState("http://localhost:1337"), runs: [{ runId: "run-plan0001-0000000a", phase: "plan", round: 0, attempt: 0, at: new Date().toISOString() }] };
    record.runIds = ["run-plan0001-0000000a"];
    patch(record);
    return record;
  }, notes);
}

const record = () => readOrchestration(TASK_ID, notes)!;
const finishLatest = (w: World, status: TaskAgentRunStatus = "done") => { const id = record().runIds.at(-1)!; w.runs.set(id, status); return id; };
const finishQa = (w: World, id: string, bugs = 0) => w.qa.set(id, { finished: true, bugs });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-auto-"));
  notes = path.join(root, "notes");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("auto mode", () => {
  it.each(["plan", "implement", "fix", "draft-pr", "verify"] as const)("dispatches %s with its picked tier effort", async (phase) => {
    const state = world({ ui: false });
    await seed((current) => {
      current.auto!.phase = phase;
      if (phase === "plan") current.auto!.attempt = 1;
      current.tiers = { ...DEFAULT_MODEL_TIERS, tiers: { ...DEFAULT_MODEL_TIERS.tiers, heavy: { provider: "claude", model: "opus", effort: "max" } } };
    });
    const dependencies = deps(state, { pickTier: async () => ({ tier: "heavy" }) });
    await advanceAuto(TASK_ID, dependencies, notes);
    expect(dependencies.dispatch).toHaveBeenCalledOnce();
    expect(vi.mocked(dependencies.dispatch).mock.calls[0][0]).toMatchObject({ provider: "claude", model: "opus", effort: "max" });
  });

  it.each(["plan", "implement", "fix", "draft-pr", "verify"] as const)("does not send effort on legacy %s runs", async (phase) => {
    const state = world({ ui: false });
    await seed((current) => { current.auto!.phase = phase; if (phase === "plan") current.auto!.attempt = 1; current.tiers = DEFAULT_MODEL_TIERS; });
    const dependencies = deps(state);
    await advanceAuto(TASK_ID, dependencies, notes);
    expect(dependencies.dispatch).toHaveBeenCalledOnce();
    expect(vi.mocked(dependencies.dispatch).mock.calls[0][0]).not.toHaveProperty("effort");
  });

  it.each([undefined, "", "low"])("resolves Default versus explicit sheet effort on later runs (%s)", async (effort) => {
    const state = world({ ui: false });
    await seed((current) => {
      current.auto!.phase = "implement";
      current.tiers = { ...DEFAULT_MODEL_TIERS, tiers: { ...DEFAULT_MODEL_TIERS.tiers, mid: { provider: "codex", model: "gpt-6", effort: "high" } } };
      current.launchOptions = { stepOverrides: { implement: { provider: "codex", model: "gpt-6-sol", effort } } };
    });
    const dependencies = deps(state);
    await advanceAuto(TASK_ID, dependencies, notes);
    expect(vi.mocked(dependencies.dispatch).mock.calls[0][0]).toMatchObject({ model: "gpt-6-sol", effort: effort || "high" });
  });

  it.each(["plan", "implement", "fix", "verify"] as const)("applies persisted launch choices to %s, including retries", async (phase) => {
    const state = world({ ui: false });
    const choice = { provider: "codex", model: "gpt-6-sol", effort: "high" };
    const reviewer = { provider: "claude", model: "opus", effort: "max" };
    const launchOptions = { instructions: "Keep the CLI stable", worktree: true, stepOverrides: { plan: choice, implement: choice, review: reviewer } };
    await seed((current) => { current.launchOptions = launchOptions; current.auto!.phase = phase; current.auto!.attempt = 1; });
    const dependencies = deps(state);
    await advanceAuto(TASK_ID, dependencies, notes);
    expect(dependencies.dispatch).toHaveBeenCalledOnce();
    const run = vi.mocked(dependencies.dispatch).mock.calls[0][0];
    expect(run).toMatchObject(phase === "verify" ? reviewer : choice);
    if (phase !== "verify") expect(run.prompt).toContain("Additional instructions from the user:\nKeep the CLI stable");
    if (phase === "plan" || phase === "implement") expect(run.worktree).toBe(true);
    expect(record().launchOptions).toEqual(launchOptions);
  });

  it("keeps launch instructions and model after plan approval", async () => {
    const { decideAutoPlan } = await import("./auto-mode");
    const state = world({ ui: false });
    const choice = { provider: "codex", model: "gpt-6-sol", effort: "high" };
    await seed((current) => {
      current.launchOptions = { instructions: "Keep compatibility", stepOverrides: { implement: choice } };
      current.auto!.pauseAfterPlan = true;
    });
    const dependencies = deps(state);
    const plan = finishLatest(state);
    await advanceAuto(TASK_ID, dependencies, notes);
    await decideAutoPlan({ taskId: TASK_ID, planRunId: plan, decision: "approve", idempotencyKey: "approve-launch-0001", action: "plan-decision" }, dependencies, notes);
    await advanceAuto(TASK_ID, dependencies, notes);
    expect(vi.mocked(dependencies.dispatch).mock.calls[0][0]).toMatchObject({ ...choice, prompt: expect.stringContaining("Keep compatibility") });
  });
  it.each(["pending", "accepted"] as const)("does not dispatch, run QA or write a handed task (%s)", async (status) => {
    const worldState = world();
    await seed();
    worldState.runs.set("run-plan0001-0000000a", "done");
    const dependencies = deps(worldState, { findTask: vi.fn(async () => ({ ...task, handoff: { handoffId: "h1", toUserId: "U2", toName: "helper", status, expiresAt: Date.now() + 1000 } })) });
    await advanceAuto(TASK_ID, dependencies, notes);
    expect(dependencies.dispatch).not.toHaveBeenCalled();
    expect(dependencies.prepareTaskQa).not.toHaveBeenCalled();
    expect(worldState.noteStatuses).toEqual([]);
  });
  it("walks plan → before video → implement → draft PR → review + Jev → ready", async () => {
    const w = world();
    w.runs.set("run-plan0001-0000000a", "running");
    await seed();
    const d = deps(w);

    expect(await advanceAuto(TASK_ID, d, notes)).toEqual([]);
    expect(record().auto!.phase).toBe("plan");

    w.runs.set("run-plan0001-0000000a", "done");
    const baseline = await advanceAuto(TASK_ID, d, notes);
    expect(baseline).toHaveLength(1);
    expect(record().auto).toMatchObject({ phase: "baseline", baselineQaRunId: "qa-1-baseline", ui: { detected: true } });
    expect(d.prepareTaskQa).toHaveBeenCalledWith(expect.objectContaining({ baseline: true, targetUrl: "http://localhost:3000" }), notes);

    finishQa(w, "qa-1-baseline");
    await advanceAuto(TASK_ID, d, notes);
    expect(record()).toMatchObject({ status: "running", executionStep: "implement", auto: { phase: "implement" } });
    expect(w.dispatched.at(-1)).toMatchObject({ action: "implement", requestId: `storyboard-auto-${TASK_ID}-${record().auto!.cycleId}-implement-r0-a0` });
    expect(w.dispatched.at(-1)!.prompt).toContain("DevHub auto mode");

    finishLatest(w);
    await advanceAuto(TASK_ID, d, notes);
    expect(record().auto).toMatchObject({ phase: "draft-pr", work: { cwd: "/repo/app" } });
    expect(w.dispatched.at(-1)).toMatchObject({ action: "create-pr" });
    expect(w.dispatched.at(-1)!.prompt).toContain("DRAFT pull request");

    finishLatest(w);
    const verify = await advanceAuto(TASK_ID, d, notes);
    expect(verify).toHaveLength(1);
    expect(record().auto).toMatchObject({ phase: "verify", verify: { reviewRunId: expect.any(String), qaRunId: "qa-2" } });
    expect(w.dispatched.at(-1)).toMatchObject({ action: "review" });

    finishLatest(w);
    await advanceAuto(TASK_ID, d, notes);
    expect(record().auto!.phase).toBe("verify"); // Jev still running
    finishQa(w, "qa-2");
    await advanceAuto(TASK_ID, d, notes);
    expect(record()).toMatchObject({ status: "ready-for-review", auto: { phase: "ready" } });
    expect(w.noteStatuses).toEqual(["in-progress", "in-progress", "draft-pr", "ready-for-review"]);
    expect(d.stopPreview).toHaveBeenCalled();
  });

  it("stops at Needs you on open plan questions and carries on once they are answered", async () => {
    const w = world({ questions: [{ id: "q1", text: "Which sidebar?", resolved: false }], ui: false });
    w.runs.set("run-plan0001-0000000a", "done");
    await seed();
    const d = deps(w);
    await advanceAuto(TASK_ID, d, notes);
    expect(record()).toMatchObject({ status: "needs-you", auto: { phase: "plan", waiting: { kind: "questions", next: "baseline" } } });
    await advanceAuto(TASK_ID, d, notes);
    expect(w.dispatched).toHaveLength(0);

    w.questions[0].resolved = true;
    await advanceAuto(TASK_ID, d, notes);
    // Not a UI change: no before video, straight to implement.
    expect(record()).toMatchObject({ status: "running", auto: { phase: "implement" } });
    expect(d.prepareTaskQa).not.toHaveBeenCalled();
  });

  it("waits for every answer, then resumes by polling without a Retry or another user action", async () => {
    const state = world({ questions: [{ id: "q1", text: "Keep the result?", resolved: false }, { id: "q2", text: "Log it?", resolved: false }], ui: false });
    state.runs.set("run-plan0001-0000000a", "done");
    await seed();
    const dependencies = deps(state);
    await advanceAuto(TASK_ID, dependencies, notes);
    expect(record().status).toBe("needs-you");
    state.questions[0].resolved = true;
    await advanceAuto(TASK_ID, dependencies, notes);
    expect(record().status).toBe("needs-you");
    expect(dependencies.dispatch).not.toHaveBeenCalled();
    state.questions[1].resolved = true;
    await advanceAuto(TASK_ID, dependencies, notes);
    expect(record()).toMatchObject({ status: "running", auto: { phase: "implement" } });
    expect(dependencies.dispatch).toHaveBeenCalledTimes(1);
    await advanceAuto(TASK_ID, dependencies, notes);
    expect(dependencies.dispatch).toHaveBeenCalledTimes(1);
  });

  it("loops review/Jev bugs into at most two fix rounds, then waits at the cap; Retry grants one more", async () => {
    const w = world({ url: null });
    await seed((r) => { r.auto!.phase = "verify"; r.auto!.verify = {}; r.auto!.work = { cwd: "/repo/app" }; });
    const d = deps(w);
    w.bugs = [{ id: "b1", status: "open", title: "Sidebar overlaps the board" }];
    for (const round of [1, 2]) {
      await advanceAuto(TASK_ID, d, notes);
      expect(record().auto!.verify).toMatchObject({ qaSkipped: expect.stringContaining("No preview") });
      finishLatest(w); // review
      await advanceAuto(TASK_ID, d, notes);
      expect(record().auto).toMatchObject({ phase: "fix", round, findings: ["Review: Sidebar overlaps the board"] });
      expect(w.dispatched.at(-1)!.prompt).toContain(`Fix round ${round} of 2`);
      finishLatest(w); // fix
      await advanceAuto(TASK_ID, d, notes);
      expect(record().auto!.phase).toBe("verify");
    }
    finishLatest(w); // third review: still a bug
    await advanceAuto(TASK_ID, d, notes);
    expect(record()).toMatchObject({ status: "needs-you", auto: { phase: "verify", round: 2, waiting: { kind: "cap" } } });

    await retryAuto(TASK_ID, "retry-key-000001", "http://localhost:1337", notes, () => true);
    await advanceAuto(TASK_ID, d, notes);
    expect(record().auto).toMatchObject({ phase: "fix", round: 3, maxRounds: 3 });
  });

  it("follows a failed run John resumed in the agent, then carries on from its result", async () => {
    const w = world();
    await seed((r) => { r.auto!.phase = "implement"; });
    const runs: Array<{ runId: string; role?: string; status: TaskAgentRunStatus; startedAt: string }> = [];
    const d = deps(w, { taskRuns: () => runs });
    await advanceAuto(TASK_ID, d, notes);
    const failed = record().auto!.runs.at(-1)!.runId;
    finishLatest(w, "failed");
    await advanceAuto(TASK_ID, d, notes);
    expect(record().status).toBe("needs-you");

    // John answers in the agent: the same run is live again.
    w.runs.set(failed, "running");
    runs.push({ runId: failed, role: "implement", status: "running", startedAt: new Date(0).toISOString() });
    await advanceAuto(TASK_ID, d, notes);
    expect(record()).toMatchObject({ status: "running", auto: { phase: "implement" } });
    expect(record().auto!.waiting).toBeUndefined();
  });

  it("follows a failed review resumed in Paseo without launching a duplicate", async () => {
    const w = world({ ui: false });
    const reviewId = "run-review01-0000000a";
    const runs: Array<{ runId: string; role: string; status: TaskAgentRunStatus; startedAt: string }> = [{ runId: reviewId, role: "review", status: "failed", startedAt: new Date(0).toISOString() }];
    await seed((r) => {
      r.auto!.phase = "verify";
      r.auto!.runs.push({ runId: reviewId, phase: "verify", round: 0, attempt: 0, at: new Date().toISOString() });
      r.auto!.verify = { reviewRunId: reviewId, qaSkipped: "Not UI" };
    });
    w.runs.set(reviewId, "failed");
    const d = deps(w, { taskRuns: () => runs });
    await advanceAuto(TASK_ID, d, notes);
    runs[0].status = "running";
    w.runs.set(reviewId, "running");
    await advanceAuto(TASK_ID, d, notes);
    expect(record().status).toBe("running");
    expect(d.dispatch).not.toHaveBeenCalled();
    w.runs.set(reviewId, "done");
    await advanceAuto(TASK_ID, d, notes);
    expect(record().status).toBe("ready-for-review");
  });

  it("cancels a review that finishes dispatching after Manual was chosen", async () => {
    const w = world();
    await seed((r) => { r.auto!.phase = "verify"; });
    const d = deps(w, { dispatch: vi.fn(async () => {
      await mutateOrchestration(TASK_ID, null, (r) => ({ ...r!, status: "paused-manual" }), notes);
      return { spec: { id: "run-review01-0000000a" } } as unknown as AgentRun;
    }) });
    await advanceAuto(TASK_ID, d, notes);
    expect(d.cancelRun).toHaveBeenCalledWith("run-review01-0000000a");
    expect(record().runIds).toContain("run-review01-0000000a");
    expect(record().status).toBe("paused-manual");
  });

  it("re-runs only QA from a finished task, as a new attempt that keeps the review", async () => {
    await seed((r) => { r.status = "ready-for-review"; r.auto!.phase = "ready"; r.auto!.verify = { reviewRunId: "run-rev", reviewDone: true, qaSkipped: "No preview: none" }; });
    await rerunVerification(TASK_ID, "qa", "rerun-key-000001", notes);
    expect(record()).toMatchObject({ status: "starting", auto: { phase: "verify", attempt: 1, verify: { reviewRunId: "run-rev", reviewDone: true } } });
    expect(record().auto!.verify!.qaSkipped).toBeUndefined();
    await expect(rerunVerification(TASK_ID, "review", "rerun-key-000002", notes)).rejects.toThrow(/already running/);
  });

  it("stops with a clear failure and drops the pin when the task's checkout and branch are gone", async () => {
    const w = world();
    await seed((r) => { r.auto!.phase = "verify"; r.auto!.work = { cwd: "/gone", worktree: { path: "/gone", branch: "devhub/agent/x", repoRoot: "/repo/app" } }; });
    await advanceAuto(TASK_ID, deps(w, { restoreWork: async () => "gone" }), notes);
    expect(record()).toMatchObject({ status: "needs-you", auto: { waiting: { kind: "failure", reason: expect.stringContaining("checkout and branch are gone") } } });
    expect(record().auto!.work).toBeUndefined();
    expect(record().auto!.phase).toBe("implement");
    const d = deps(w);
    await retryAuto(TASK_ID, "retry-missing-work", "http://fixture", notes, () => true);
    await advanceAuto(TASK_ID, d, notes);
    expect(w.dispatched.at(-1)?.action).toBe("implement");
  });

  it("keeps the pinned work when restoring its existing branch fails", async () => {
    const w = world();
    const work = { cwd: "/repo/missing", worktree: { path: "/repo/missing", branch: "task", repoRoot: "/repo/app" } };
    await seed((r) => { r.auto!.phase = "verify"; r.auto!.work = work; });
    const d = deps(w, { restoreWork: async () => { throw new Error("branch is already checked out elsewhere"); } });
    await advanceAuto(TASK_ID, d, notes);
    expect(record()).toMatchObject({ status: "needs-you", auto: { work, waiting: { kind: "failure", reason: expect.stringContaining("already checked out") } } });
    expect(d.dispatch).not.toHaveBeenCalled();
  });

  it("treats a stopped run that left questions in the note as waiting for answers, not failed", async () => {
    const w = world({ questions: [{ id: "q1", text: "Which scope?", resolved: false }, { id: "q2", text: "Who owns it?", resolved: false }] });
    await seed((r) => { r.auto!.phase = "plan"; });
    const d = deps(w);
    await advanceAuto(TASK_ID, d, notes);
    finishLatest(w, "paused");
    await advanceAuto(TASK_ID, d, notes);
    expect(record()).toMatchObject({ status: "needs-you", auto: { waiting: { kind: "questions", reason: expect.stringContaining("2 open questions"), next: "plan" } } });
    // Answering both runs the same step again, as a new attempt.
    w.questions.forEach((question) => { question.resolved = true; });
    await advanceAuto(TASK_ID, d, notes);
    expect(record().auto).toMatchObject({ phase: "plan", attempt: 1 });
  });

  it("finishes a report-only implementation without a PR, review or QA", async () => {
    const w = world();
    await seed((r) => { r.auto!.phase = "implement"; });
    const d = deps(w, { workChanged: async () => false });
    await advanceAuto(TASK_ID, d, notes);
    finishLatest(w, "done");
    await advanceAuto(TASK_ID, d, notes);
    expect(record()).toMatchObject({ status: "ready-for-review", auto: { phase: "ready" }, lastError: expect.stringContaining("No code changed") });
    expect(w.dispatched.map((entry) => entry.action)).toEqual(["implement"]);
    expect(w.noteStatuses.at(-1)).toBe("ready-for-review");
  });

  it("still opens the draft PR when files changed, or git can't say", async () => {
    for (const changed of [true, null]) {
      const w = world();
      await seed((r) => { r.auto!.phase = "implement"; });
      const d = deps(w, { workChanged: async () => changed });
      await advanceAuto(TASK_ID, d, notes);
      finishLatest(w, "done");
      await advanceAuto(TASK_ID, d, notes);
      expect(record().auto!.phase).toBe("draft-pr");
    }
  });

  it("waits at Needs you when a run fails, and Retry re-runs it on a fresh request", async () => {
    const w = world();
    await seed((r) => { r.auto!.phase = "implement"; });
    const d = deps(w);
    await advanceAuto(TASK_ID, d, notes);
    finishLatest(w, "failed");
    await advanceAuto(TASK_ID, d, notes);
    expect(record()).toMatchObject({ status: "needs-you", auto: { waiting: { kind: "failure", reason: expect.stringContaining("Implement run failed") } } });
    expect(w.noteStatuses.at(-1)).toBe("needs-you");

    await retryAuto(TASK_ID, "retry-key-000002", "http://localhost:1337", notes, () => true, "Use a longer timeout");
    await advanceAuto(TASK_ID, d, notes);
    expect(record().auto).toMatchObject({ phase: "implement", attempt: 1, recoveryGuidance: { text: "Use a longer timeout", phase: "implement", attempt: 1 } });
    expect(w.dispatched.at(-1)?.prompt).toContain("Use a longer timeout");
    expect(w.dispatched.map((item) => item.requestId)).toEqual([`storyboard-auto-${TASK_ID}-${record().auto!.cycleId}-implement-r0-a0`, `storyboard-auto-${TASK_ID}-${record().auto!.cycleId}-implement-r0-a1`]);
  });

  it("keeps Build's checkout decision when Build is retried, so the label doesn't flip mid-run", async () => {
    const w = world();
    await seed((r) => { r.auto!.phase = "implement"; });
    const choices = [{ mode: "worktree" as const, reason: "task looks large" }, { mode: "checkout" as const, reason: "clean" }];
    const chooseCheckout = vi.fn(async () => ({ ...choices.shift()!, decidedAt: new Date().toISOString() }));
    const d = deps(w, { chooseCheckout });
    await advanceAuto(TASK_ID, d, notes);
    expect(record().checkout).toMatchObject({ mode: "worktree", reason: "task looks large" });
    finishLatest(w, "failed");
    await advanceAuto(TASK_ID, d, notes);
    await retryAuto(TASK_ID, "retry-key-000003", "http://localhost:1337", notes, () => true);
    await advanceAuto(TASK_ID, d, notes);
    expect(record().auto).toMatchObject({ phase: "implement", attempt: 1 });
    expect(chooseCheckout).toHaveBeenCalledTimes(1);
    expect(record().checkout).toMatchObject({ mode: "worktree", reason: "task looks large" });
  });

  it.each(["checkout has uncommitted changes", "1 other run active on this repo"])("refuses a checkout retry when %s, then resumes once safe", async (reason) => {
    const w = world({ heavy: 1 });
    await seed((r) => { r.auto!.phase = "implement"; });
    const decidedAt = new Date().toISOString();
    const chooseCheckout = vi.fn()
      .mockResolvedValueOnce({ mode: "checkout", reason: "clean", decidedAt })
      .mockResolvedValueOnce({ mode: "worktree", reason, decidedAt })
      .mockResolvedValueOnce({ mode: "checkout", reason: "clean", decidedAt });
    const d = deps(w, { chooseCheckout });
    await advanceAuto(TASK_ID, d, notes);
    finishLatest(w, "failed");
    await advanceAuto(TASK_ID, d, notes);
    await retryAuto(TASK_ID, "retry-key-unsafe", "http://localhost:1337", notes, () => true);
    await advanceAuto(TASK_ID, d, notes);
    expect(d.dispatch).toHaveBeenCalledTimes(1);
    expect(record()).toMatchObject({ status: "needs-you", checkout: { mode: "checkout" }, auto: { waiting: { kind: "failure", reason: expect.stringContaining(reason) } } });
    await retryAuto(TASK_ID, "retry-key-safe", "http://localhost:1337", notes, () => true);
    await advanceAuto(TASK_ID, d, notes);
    expect(d.dispatch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(d.dispatch).mock.calls.at(-1)![0]).toMatchObject({ cwd: "/repo/app", worktree: false });
  });

  it("is idempotent: concurrent pollers and a lost write dispatch one run", async () => {
    const w = world();
    await seed((r) => { r.auto!.phase = "implement"; });
    const d = deps(w);
    await Promise.all([advanceAuto(TASK_ID, d, notes), advanceAuto(TASK_ID, d, notes)]);
    expect(new Set(w.byRequest.values()).size).toBe(1);
    expect(record().auto!.runs.filter((run) => run.phase === "implement")).toHaveLength(1);

    // Restart between dispatch and write: the record forgot the run, the request ID did not.
    await mutateOrchestration(TASK_ID, null, (current) => { current!.auto!.runs = current!.auto!.runs.filter((run) => run.phase !== "implement"); current!.runIds = ["run-plan0001-0000000a"]; return current; }, notes);
    await advanceAuto(TASK_ID, deps(w), notes);
    expect(record().auto!.runs.filter((run) => run.phase === "implement").map((run) => run.runId)).toEqual([...w.byRequest.values()]);
  });

  it("queues while two heavy jobs run, then dispatches", async () => {
    const w = world({ heavy: 2 });
    await seed((r) => { r.auto!.phase = "implement"; });
    const d = deps(w);
    await advanceAuto(TASK_ID, d, notes);
    expect(record()).toMatchObject({ status: "starting", auto: { waiting: { kind: "queued" } } });
    expect(w.dispatched).toHaveLength(0);
    w.heavy = 1;
    await advanceAuto(TASK_ID, d, notes);
    expect(record()).toMatchObject({ status: "running" });
    expect(record().auto!.waiting).toBeUndefined();
  });

  it("leaves Manual alone and never advances a record from before auto mode until it is retried", async () => {
    const w = world();
    w.runs.set("run-plan0001-0000000a", "done");
    await seed((r) => { r.status = "paused-manual"; });
    await advanceAuto(TASK_ID, deps(w), notes);
    expect(w.dispatched).toHaveLength(0);

    await mutateOrchestration(TASK_ID, null, (current) => { delete current!.auto; current!.status = "running"; return current; }, notes);
    await advanceAuto(TASK_ID, deps(w), notes);
    expect(record().auto).toBeUndefined();
    await retryAuto(TASK_ID, "retry-key-000003", "http://localhost:1337", notes, () => true);
    expect(record().auto).toMatchObject({ phase: "baseline", runs: [{ runId: "run-plan0001-0000000a", phase: "plan" }] });
  });

  it("the card's UI toggle wins over detection", async () => {
    const w = world({ ui: false });
    w.runs.set("run-plan0001-0000000a", "done");
    await seed();
    await setUiOverride(TASK_ID, true, notes);
    const d = deps(w);
    await advanceAuto(TASK_ID, d, notes);
    expect(record().auto).toMatchObject({ phase: "baseline", ui: { detected: false, override: true } });
    expect(d.prepareTaskQa).toHaveBeenCalled();
  });

  it("dispatches on the tier auto mode picked and records why on the run", async () => {
    const w = world();
    await seed((r) => { r.auto!.phase = "implement"; r.auto!.attempt = 1; });
    await advanceAuto(TASK_ID, deps(w, { pickTier: async () => ({ tier: "heavy", reason: "↑ mid → heavy: retry after a failed run" }) }), notes);
    expect(w.dispatched.at(-1)).toMatchObject({ tier: "heavy", tierReason: "↑ mid → heavy: retry after a failed run" });
    expect(record().auto!.runs.at(-1)).toMatchObject({ phase: "implement", tier: "heavy", tierReason: "↑ mid → heavy: retry after a failed run" });
  });

  it("waits while DevHub starts the repo's preview, records the before video, then stops it", async () => {
    const w = world({ url: null });
    w.runs.set("run-plan0001-0000000a", "done");
    await seed();
    let preview: { url: string | null; state: "starting" | "started"; reason: string } = { url: null, state: "starting", reason: "Starting the dev server: npm run dev" };
    const d = deps(w, { resolvePreview: vi.fn(async () => preview) });

    await advanceAuto(TASK_ID, d, notes);
    await advanceAuto(TASK_ID, d, notes);
    expect(record().auto).toMatchObject({ phase: "baseline", preview: { state: "starting" } });
    expect(record().auto!.baselineQaRunId).toBeUndefined();

    preview = { url: "http://localhost:4100/", state: "started", reason: "DevHub started the preview at http://localhost:4100/." };
    await advanceAuto(TASK_ID, d, notes);
    expect(record().auto).toMatchObject({ baselineQaRunId: "qa-1-baseline", preview: { state: "started", url: "http://localhost:4100/" } });
    expect(d.prepareTaskQa).toHaveBeenCalledWith(expect.objectContaining({ baseline: true, targetUrl: "http://localhost:4100/" }), notes);

    finishQa(w, "qa-1-baseline");
    await advanceAuto(TASK_ID, d, notes);
    expect(record().auto!.phase).toBe("implement");
    expect(d.stopPreview).toHaveBeenCalledWith(TASK_ID);
  });

  it("skips Jev with a no-preview reason instead of blocking", async () => {
    const w = world({ url: null });
    w.runs.set("run-plan0001-0000000a", "done");
    await seed();
    const d = deps(w);
    await advanceAuto(TASK_ID, d, notes);
    expect(record().auto).toMatchObject({ phase: "implement", preview: { state: "none", reason: "The task has no preview URL." } });
    expect(d.prepareTaskQa).not.toHaveBeenCalled();
  });

  it("stops once for a task ticked done, instead of rewriting the record on every tick", async () => {
    const w = world();
    await seed((r) => { r.auto!.phase = "verify"; r.auto!.verify = {}; r.auto!.work = { cwd: "/repo/app" }; });
    const start = record().revision;
    const closed = deps(w, { findTask: vi.fn(async () => ({ ...task, done: true }) as Task) });
    await advanceAuto(TASK_ID, closed, notes);
    expect(record()).toMatchObject({ status: "paused", lastError: "The task was ticked done, so auto mode stopped." });
    expect(record().revision).toBe(start + 1);
    // Every later tick and board poll used to bump the revision 8 times (and rewrite a git-synced file each time).
    await advanceAuto(TASK_ID, closed, notes);
    await advanceAuto(TASK_ID, closed, notes);
    expect(record().revision).toBe(start + 1);
    expect(w.dispatched).toHaveLength(0);
  });

  it("does not carry on for an abandoned task, which the board no longer shows", async () => {
    const w = world();
    w.runs.set("run-plan0001-0000000a", "done");
    await seed();
    const d = deps(w, { findTask: vi.fn(async () => ({ ...task, abandonedAt: "2026-10-17T09:00:00.000Z" }) as Task) });
    await advanceAuto(TASK_ID, d, notes);
    await advanceAuto(TASK_ID, d, notes);
    expect(record()).toMatchObject({ status: "paused", lastError: "The task was abandoned, so auto mode stopped.", auto: { phase: "plan" } });
    expect(w.dispatched).toHaveLength(0);
    expect(d.prepareTaskQa).not.toHaveBeenCalled();
  });

  it("retries a dropped Paseo connection for a few minutes before calling the step failed", async () => {
    const w = world({ failDispatch: "Paseo is running but didn't answer in time. Try again in a moment." });
    await seed((r) => { r.auto!.phase = "implement"; });
    const d = deps(w);
    await advanceAuto(TASK_ID, d, notes);
    expect(record()).toMatchObject({ status: "starting", auto: { waiting: { kind: "queued", reason: expect.stringContaining("Trying again") } } });
    const firstAt = record().auto!.waiting!.at;
    await advanceAuto(TASK_ID, d, notes);
    expect(record().auto!.waiting).toMatchObject({ kind: "queued", at: firstAt });
    // Past the window it is a failure with the real reason.
    await mutateOrchestration(TASK_ID, null, (current) => { current!.auto!.waiting!.at = new Date(Date.now() - 4 * 60_000).toISOString(); return current; }, notes);
    await advanceAuto(TASK_ID, d, notes);
    expect(record()).toMatchObject({ status: "needs-you", auto: { waiting: { kind: "failure" } } });
  });

  it("puts the card in Needs you in its note when a step can't start, but not while it only queues", async () => {
    const failing = world({ failDispatch: "The agent runtime refused the run." });
    await seed((r) => { r.auto!.phase = "implement"; });
    await advanceAuto(TASK_ID, deps(failing), notes);
    expect(record()).toMatchObject({ status: "needs-you", auto: { waiting: { kind: "failure", reason: expect.stringContaining("Couldn't start Implement") } } });
    expect(failing.noteStatuses).toEqual(["needs-you"]);

    // The review of a verify phase is a start too.
    const review = world({ failDispatch: "The agent runtime refused the run." });
    await seed((r) => { r.auto!.phase = "verify"; r.auto!.verify = {}; r.auto!.work = { cwd: "/repo/app" }; });
    await advanceAuto(TASK_ID, deps(review), notes);
    expect(record().auto!.waiting).toMatchObject({ kind: "failure", reason: expect.stringContaining("Couldn't start the review") });
    expect(review.noteStatuses).toEqual(["needs-you"]);

    // A review run that ended badly is a stop too.
    const ended = world();
    ended.runs.set("run-review-0000000a", "failed");
    await seed((r) => { r.auto!.phase = "verify"; r.auto!.verify = { reviewRunId: "run-review-0000000a" }; r.auto!.work = { cwd: "/repo/app" }; });
    await advanceAuto(TASK_ID, deps(ended), notes);
    expect(record().auto!.waiting).toMatchObject({ kind: "failure", reason: "The review run failed. Retry to run it again." });
    expect(ended.noteStatuses).toEqual(["needs-you"]);

    // Waiting for a free slot is not a stop: the card keeps its column.
    const queued = world({ heavy: 2 });
    await seed((r) => { r.auto!.phase = "implement"; });
    await advanceAuto(TASK_ID, deps(queued), notes);
    expect(record().auto!.waiting).toMatchObject({ kind: "queued" });
    expect(queued.noteStatuses).toEqual([]);
  });
});

it("starts fresh agent and QA attempts after a reset", async () => {
  const w = world();
  const d = deps(w);
  await seed((r) => { r.auto!.phase = "verify"; r.auto!.work = { cwd: "/repo/app" }; });
  await advanceAuto(TASK_ID, d, notes);
  const firstReview = record().auto!.verify!.reviewRunId;
  const firstQaSource = vi.mocked(d.prepareTaskQa).mock.calls[0][0].sourceRunId;
  await deleteOrchestration(TASK_ID, notes);
  await seed((r) => { r.auto!.phase = "verify"; r.auto!.work = { cwd: "/repo/app" }; });
  await advanceAuto(TASK_ID, d, notes);
  expect(record().auto!.verify!.reviewRunId).not.toBe(firstReview);
  expect(vi.mocked(d.prepareTaskQa).mock.calls[1][0].sourceRunId).not.toBe(firstQaSource);
});

it("scopes recovery guidance to the retried phase and attempt", async () => {
  const { withRecoveryGuidance } = await import("./auto-mode");
  const auto = { ...newAutoState("http://fixture"), recoveryGuidance: { text: "Check the timeout", phase: "plan" as const, attempt: 0 } };
  expect(withRecoveryGuidance("Plan", auto)).toContain("Check the timeout");
  expect(withRecoveryGuidance("Implement", { ...auto, phase: "implement" })).toBe("Implement");
  expect(withRecoveryGuidance("Retry", { ...auto, attempt: 1 })).toBe("Retry");
});

describe("pause after planning", () => {
  const decision = (planRunId: string, patch = {}) => ({ action: "plan-decision" as const, taskId: TASK_ID, planRunId, decision: "approve" as const, idempotencyKey: "approve-plan-0001", ...patch });

  it("keeps reopened feedback on its restored branch through plan approval", async () => {
    const { decideAutoPlan } = await import("./auto-mode");
    const w = world({ ui: false });
    const d = deps(w);
    const work = { cwd: "/repo/restored", worktree: { path: "/repo/restored", branch: "task-feedback", repoRoot: "/repo/app" } };
    d.runWork = () => work;
    w.runs.set("old-implementation", "done");
    await seed((current) => {
      Object.assign(current.auto!, { pauseAfterPlan: true, attempt: 1, work, feedbackKey: "new-feedback", feedbackBrief: "@reviewer: Handle the empty response" });
      current.auto!.runs.push({ runId: "old-implementation", phase: "implement", round: 0, attempt: 0, at: new Date().toISOString() });
    });
    await advanceAuto(TASK_ID, d, notes);
    expect(d.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ cwd: work.cwd, worktree: false, inherit: { worktree: work.worktree } }), { defer: true });
    const plan = finishLatest(w);
    await advanceAuto(TASK_ID, d, notes);
    expect(record().auto?.waiting?.kind).toBe("plan-approval");
    await decideAutoPlan(decision(plan), d, notes);
    await advanceAuto(TASK_ID, d, notes);
    expect(d.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: expect.stringContaining("-fnew-feedback"), cwd: work.cwd, worktree: false, inherit: { worktree: work.worktree }, prompt: expect.stringContaining("@reviewer: Handle the empty response") }), { defer: true });
    expect(w.dispatched.at(-1)?.prompt).not.toContain("Create or switch to a task branch");
    expect(w.dispatched.at(-1)?.prompt).toContain("push to the PR branch task-feedback with plain `git push`");
    expect(w.dispatched.at(-1)?.prompt).toContain("Push failed:");
    finishLatest(w);
    await advanceAuto(TASK_ID, d, notes);
    expect(record().auto).toMatchObject({ phase: "verify", work });
    expect(w.dispatched.some((run) => run.action === "create-pr")).toBe(false);
  });

  it("holds before baseline, survives polling, and approves exactly once", async () => {
    const { decideAutoPlan } = await import("./auto-mode");
    const w = world();
    const d = deps(w);
    await seed((r) => { r.auto!.pauseAfterPlan = true; });
    const plan = finishLatest(w);
    await advanceAuto(TASK_ID, d, notes);
    expect(record()).toMatchObject({ status: "needs-you", auto: { phase: "plan", waiting: { kind: "plan-approval" } } });
    expect(record().lastError).toBeUndefined();
    const revision = record().revision;
    await advanceAuto(TASK_ID, d, notes);
    expect(record().revision).toBe(revision);
    expect(d.dispatch).not.toHaveBeenCalled();
    expect(d.prepareTaskQa).not.toHaveBeenCalled();
    await expect(retryAuto(TASK_ID, "retry-plan-00001", "http://fixture", notes, () => true)).rejects.toMatchObject({ status: 409 });
    await decideAutoPlan(decision(plan), d, notes);
    await decideAutoPlan(decision(plan), d, notes);
    expect(record().auto).toMatchObject({ phase: "baseline", pauseAfterPlan: true });
    await advanceAuto(TASK_ID, d, notes);
    expect(d.prepareTaskQa).toHaveBeenCalledTimes(1);
  });

  it("replans with feedback, pauses again, and rejects stale approval", async () => {
    const { decideAutoPlan } = await import("./auto-mode");
    const w = world(); const d = deps(w);
    await seed((r) => { r.auto!.pauseAfterPlan = true; });
    const first = finishLatest(w);
    await advanceAuto(TASK_ID, d, notes);
    await decideAutoPlan({ ...decision(first), decision: "revise", guidance: "Keep the existing API unchanged." }, d, notes);
    await advanceAuto(TASK_ID, d, notes);
    expect(w.dispatched).toHaveLength(1);
    expect(w.dispatched[0].prompt).toContain("Keep the existing API unchanged.");
    const revised = finishLatest(w);
    await advanceAuto(TASK_ID, d, notes);
    expect(record().auto).toMatchObject({ phase: "plan", attempt: 1, waiting: { kind: "plan-approval" } });
    await expect(decideAutoPlan({ ...decision(first), idempotencyKey: "stale-approval-01" }, d, notes)).rejects.toMatchObject({ status: 409 });
    await expect(decideAutoPlan({ ...decision(revised), idempotencyKey: "missing-feedback", decision: "revise" }, d, notes)).rejects.toMatchObject({ status: 400 });
    await decideAutoPlan({ ...decision(revised), idempotencyKey: "approve-revised-1" }, d, notes);
    expect(record().auto?.phase).toBe("baseline");
  });

  it("answering plan questions still requires approval, including after restart", async () => {
    const w = world({ questions: [{ id: "q", text: "Keep the API?", resolved: false }] });
    await seed((r) => { r.auto!.pauseAfterPlan = true; });
    finishLatest(w);
    await advanceAuto(TASK_ID, deps(w), notes);
    expect(record().auto?.waiting?.kind).toBe("questions");
    w.questions[0].resolved = true;
    await advanceAuto(TASK_ID, deps(w), notes);
    expect(record().auto?.waiting?.kind).toBe("plan-approval");
    expect(w.dispatched).toHaveLength(0);
  });
});

describe("asking back", () => {
  it("reruns the stopped step with the question as guidance for that attempt", async () => {
    await seed((r) => { r.status = "needs-you"; r.auto!.waiting = { kind: "questions", reason: "1 open question", at: new Date().toISOString() }; });
    await askBackAuto(TASK_ID, "What does Android do today?", "ask-key-000000001", notes);
    expect(record()).toMatchObject({ status: "starting", auto: { phase: "plan", attempt: 1, recoveryGuidance: { phase: "plan", attempt: 1 } } });
    expect(record().auto!.recoveryGuidance!.text).toContain("What does Android do today?");
    await expect(askBackAuto(TASK_ID, "again", "ask-key-000000002", notes)).rejects.toThrow(/isn't waiting/);
  });
});
