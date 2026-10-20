import { describe, expect, it } from "vitest";
import { canSwitchMode, orchestrationChip, stepForRole, storyboardHrefForTask, summariseOrchestration, type OrchestrationSummary } from "./orchestration";
import { newOrchestration } from "./orchestration-store";
import { newAutoState } from "./auto-mode";

const summary = (patch: Partial<OrchestrationSummary>): OrchestrationSummary => ({
  taskId: "t1", taskDate: "2026-10-15", status: "running", executionStep: "plan", openQuestions: 0, runCount: 1, updatedAt: "2026-10-15T09:00:00.000Z", ...patch,
});

describe("orchestration helpers", () => {
  it("maps run roles onto the four steps", () => {
    expect([stepForRole("plan"), stepForRole("discuss"), stepForRole("implement"), stepForRole(undefined), stepForRole("verify"), stepForRole("review")])
      .toEqual(["plan", "plan", "implement", "implement", "verify", "verify"]);
  });

  it("summarises open questions, runs and the PR", () => {
    const record = { ...newOrchestration({ taskId: "t1", taskDate: "2026-10-15" }), runIds: ["a", "b"], terminal: { kind: "pr-created" as const, at: "2026-10-15T10:00:00.000Z", prUrl: "https://github.com/o/r/pull/1" } };
    record.questions = [
      { id: "q1", stepId: "plan", kind: "repo", prompt: "Which repo?", state: "open", askedAt: record.createdAt },
      { id: "q2", stepId: "plan", kind: "blocker", prompt: "Old", state: "answered", askedAt: record.createdAt },
    ];
    expect(summariseOrchestration(record, "running")).toMatchObject({ openQuestions: 1, waitingOnRepo: true, runCount: 2, prUrl: "https://github.com/o/r/pull/1", latestRunStatus: "running" });
    record.questions = record.questions.map((question) => ({ ...question, state: "answered" as const }));
    expect(summariseOrchestration(record).waitingOnRepo).toBeUndefined();
  });

  it.each([
    [{ status: "running" as const }, "On auto", "running"],
    [{ status: "running" as const, latestRunStatus: "running" as const }, "On auto", "running"],
    [{ status: "running" as const, latestRunStatus: "done" as const }, "Plan done", "ready"],
    [{ status: "needs-you" as const, openQuestions: 1 }, "Needs you", "paused"],
    [{ status: "paused" as const, lastError: "Paseo is unavailable." }, "Paused", "paused"],
    [{ status: "pr-created" as const }, "PR ready", "ready"],
  ])("chips %o as %s", (patch, label, kind) => {
    expect(orchestrationChip(summary(patch))).toMatchObject({ label, kind });
  });

  it("keeps the checkout label stable on auto: hidden until Build decides, then Build's decision", () => {
    const base = newOrchestration({ taskId: "t1", taskDate: "2026-10-15" });
    const at = base.createdAt;
    const planned = { ...base, checkout: { mode: "checkout" as const, reason: "clean checkout, no other active run, small task", decidedAt: at }, auto: { ...newAutoState("http://x"), runs: [{ runId: "p", phase: "plan" as const, round: 0, attempt: 0, at }] } };
    expect(summariseOrchestration(planned).checkout).toBeUndefined();
    const built = { ...planned, checkout: { mode: "worktree" as const, reason: "task looks large", decidedAt: at }, auto: { ...planned.auto, phase: "fix" as const, runs: [...planned.auto.runs, { runId: "i", phase: "implement" as const, round: 0, attempt: 0, at }] } };
    expect(summariseOrchestration(built).checkout).toEqual({ mode: "worktree", reason: "task looks large" });
    // Not on auto: the latest decision, as before.
    expect(summariseOrchestration({ ...base, checkout: planned.checkout }).checkout).toMatchObject({ mode: "checkout" });
  });

  it("has no chip once stopped", () => {
    expect(orchestrationChip(summary({ status: "stopped" }))).toBeNull();
  });

  it("links to the task on Storyboard, project first when known", () => {
    expect(storyboardHrefForTask("t1")).toBe("/storyboard?task=t1");
    expect(storyboardHrefForTask("t 1")).toBe("/storyboard?task=t%201");
  });

  it("hides the Auto/Manual switch until a run exists, even on needs-you or paused", () => {
    expect(canSwitchMode({ status: "needs-you", runCount: 0 })).toBe(false);
    expect(canSwitchMode({ status: "paused", runCount: 0 })).toBe(false);
    expect(canSwitchMode({ status: "needs-you", runCount: 1 })).toBe(true);
    expect(canSwitchMode({ status: "running", runCount: 1 })).toBe(true);
  });
});
