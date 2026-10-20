import { describe, expect, it } from "vitest";
import { cardAttention, IDLE_AFTER_MS } from "./attention";
import type { BoardCard } from "./notes-board-shared";

const base: Pick<BoardCard, "taskId" | "status" | "taskDone" | "noteHref" | "prUrl" | "run" | "counts"> = {
  taskId: "task-1",
  status: "in-progress",
  taskDone: false,
  noteHref: "/notes/task-notes/2026-10-16-task-1",
  prUrl: undefined,
  run: null,
  counts: { openQuestions: 0, openBugs: 0, blockerBugs: 0, decisions: 0 },
};
const run = (status: string, startedAt = "2026-10-16T10:00:00Z") => ({ runId: "r1", status, startedAt });
const now = Date.parse("2026-10-16T10:30:00Z");

describe("cardAttention", () => {
  it("is quiet for healthy cards", () => {
    expect(cardAttention(base, now)).toBeNull();
    expect(cardAttention({ ...base, run: run("done") }, now)).toBeNull();
    expect(cardAttention({ ...base, run: run("running") }, now)).toBeNull();
  });

  it("asks John to answer, opening the note at its questions", () => {
    const href = "/notes/task-notes/2026-10-16-task-1#task-note-questions";
    expect(cardAttention({ ...base, status: "needs-you", counts: { ...base.counts, openQuestions: 1 } }, now)).toMatchObject({ reason: "awaiting", action: { kind: "open", href } });
    // Needs-you with nothing in the note to answer must not offer an empty Answer.
    expect(cardAttention({ ...base, status: "needs-you" }, now)).toBeNull();
    expect(cardAttention({ ...base, counts: { ...base.counts, openQuestions: 2 } }, now)?.action).toMatchObject({ kind: "open", href });
  });

  it("offers Open PR when a PR is waiting for review", () => {
    const url = "https://github.com/x/y/pull/1";
    expect(cardAttention({ ...base, status: "ready-for-review", prUrl: url }, now)).toMatchObject({ label: "PR awaiting review", action: { kind: "open-pr", url } });
    expect(cardAttention({ ...base, status: "draft-pr", prUrl: url }, now)).toBeNull();
    expect(cardAttention({ ...base, status: "ready-for-review" }, now)).toBeNull();
  });

  it("offers Retry for a failed run or an open blocker bug", () => {
    expect(cardAttention({ ...base, run: run("failed") }, now)).toMatchObject({ reason: "failing", label: "Run failed", action: { kind: "retry", taskId: "task-1" } });
    expect(cardAttention({ ...base, counts: { ...base.counts, openBugs: 1, blockerBugs: 1 } }, now)).toMatchObject({ reason: "failing", label: "Blocker bug open", action: { kind: "retry" } });
    expect(cardAttention({ ...base, counts: { ...base.counts, openBugs: 3 } }, now)).toBeNull();
  });

  it("offers Clear for long-running idle agents", () => {
    const old = new Date(now - IDLE_AFTER_MS - 1).toISOString();
    expect(cardAttention({ ...base, run: run("running", old) }, now)).toMatchObject({ reason: "idle", action: { kind: "clear", taskId: "task-1", runId: "r1" } });
  });

  it("only offers Retry for a failed implementation run: Retry resumes the implementation agent", () => {
    expect(cardAttention({ ...base, run: { ...run("failed"), role: "implement" } }, now)).toMatchObject({ reason: "failing", action: { kind: "retry" } });
    for (const role of ["review", "plan", "verify", "discuss"]) {
      expect(cardAttention({ ...base, run: { ...run("failed"), role } }, now)).toBeNull();
    }
  });

  it("sends the orchestrator's question to the Storyboard card, since it is not in the note", () => {
    expect(cardAttention({ ...base, orchestratorWaiting: true }, now)).toMatchObject({ reason: "awaiting", action: { kind: "open", href: "/storyboard?task=task-1" } });
    expect(cardAttention({ ...base, noteHref: null, orchestratorWaiting: true }, now)?.action).toMatchObject({ kind: "open", href: "/storyboard?task=task-1" });
    const noted = { ...base, counts: { ...base.counts, openQuestions: 1 }, orchestratorWaiting: true };
    expect(cardAttention(noted, now)?.action).toMatchObject({ href: "/notes/task-notes/2026-10-16-task-1#task-note-questions" });
    expect(cardAttention({ ...base, noteHref: null, status: "needs-you" }, now)).toBeNull();
  });

  it("does not ask for a review of a merged or closed PR", () => {
    const url = "https://github.com/x/y/pull/1";
    const review = { ...base, status: "ready-for-review" as const, prUrl: url };
    expect(cardAttention({ ...review, prState: "open" }, now)).toMatchObject({ label: "PR awaiting review" });
    expect(cardAttention({ ...review, prState: "merged" }, now)).toBeNull();
    expect(cardAttention({ ...review, prState: "closed" }, now)).toBeNull();
  });

  it("answers before it retries", () => {
    expect(cardAttention({ ...base, status: "needs-you", counts: { ...base.counts, openQuestions: 1 }, run: run("failed") }, now)?.reason).toBe("awaiting");
  });

  it("ignores finished work", () => {
    expect(cardAttention({ ...base, status: "done", run: run("failed") }, now)).toBeNull();
    expect(cardAttention({ ...base, taskDone: true, run: run("failed") }, now)).toBeNull();
  });

  it("auto mode at Needs you after a failure or the cap offers its own Retry", () => {
    expect(cardAttention({ ...base, status: "needs-you", autoWaiting: { kind: "failure", reason: "The Implement run failed." } }, now))
      .toEqual({ reason: "failing", label: "The Implement run failed.", action: { kind: "auto-retry", label: "Retry", taskId: "task-1" } });
    expect(cardAttention({ ...base, status: "needs-you", autoWaiting: { kind: "cap", reason: "1 bug left after 2 fix rounds." } }, now)?.action)
      .toEqual({ kind: "auto-retry", label: "One more round", taskId: "task-1" });
    // Questions are answered in the note, as before.
    expect(cardAttention({ ...base, status: "needs-you", counts: { ...base.counts, openQuestions: 1 }, autoWaiting: { kind: "questions", reason: "1 open question" } }, now)?.action).toMatchObject({ kind: "open" });
  });

  it("offers Answer ahead of a failed-step Retry while questions are open", () => {
    const failing = { ...base, status: "needs-you" as const, counts: { ...base.counts, openQuestions: 2 }, autoWaiting: { kind: "failure" as const, reason: "The Plan run paused." } };
    expect(cardAttention(failing, now)?.action).toMatchObject({ kind: "open", label: "Answer" });
    expect(cardAttention({ ...failing, counts: { ...base.counts, openQuestions: 0 } }, now)?.action).toMatchObject({ kind: "auto-retry" });
  });
});
