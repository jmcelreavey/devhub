import { describe, expect, it } from "vitest";
import { needsYouWork, resolveNextAction } from "./next-action";
import type { BoardCard } from "./notes-board-shared";
import type { TaskWorkflow } from "@/lib/workflows/types";

const now = Date.parse("2026-10-17T12:00:00Z");
const base: BoardCard = {
  taskId: "task-1", title: "A task", date: "2026-10-17", status: "todo", taskDone: false,
  notePath: "task-notes/task-1", noteHref: "/notes/task-notes/task-1", tags: [], links: [], models: [], summary: [],
  counts: { openQuestions: 0, openBugs: 0, blockerBugs: 0, decisions: 0 }, screenshot: null, images: [], jev: null,
  tiers: null, run: null, steps: [], updatedAt: "2026-10-17T11:59:00Z", attention: null,
};
const auto = (patch: Partial<NonNullable<BoardCard["auto"]>> = {}): NonNullable<BoardCard["auto"]> => ({
  status: "needs-you", phase: "fix", label: "Fix", round: 2, maxRounds: 2, ...patch,
});
const workflow = (patch: Partial<TaskWorkflow> = {}): TaskWorkflow => ({
  version: 1, taskId: base.taskId, revision: 4, seenRevision: 4, stage: "draft-pr", status: "waiting-user", checks: [], reviews: [], events: [],
  proposals: [{ id: "proposal-1", kind: "draft-pr", runId: "run-1", fingerprint: "abc", contentHash: "def", destination: "acme/app", content: "Draft PR", expiresAt: "2026-10-18T12:00:00Z", state: "pending" }],
  ...patch,
});

describe("next action behaviour contract", () => {
  it.each<{ situation: string; patch: Partial<BoardCard>; workflow?: TaskWorkflow; label: string }>([
    { situation: "plan ready", patch: { status: "needs-you", auto: auto({ phase: "plan", waiting: { kind: "plan-approval", reason: "Plan ready" } }) }, label: "Approve plan" },
    { situation: "unstarted agent task", patch: {}, label: "Start on auto" },
    { situation: "missing repo", patch: { status: "needs-you", waitingOnRepo: true, attention: { reason: "awaiting", label: "Waiting on you", action: { kind: "open", label: "Answer", href: "/storyboard?task=task-1" } } }, label: "Choose repo" },
    { situation: "running", patch: { status: "in-progress", run: { runId: "run-1", status: "running", startedAt: "2026-10-17T11:59:00Z" } }, label: "View progress" },
    { situation: "question", patch: { counts: { ...base.counts, openQuestions: 2 } }, label: "Answer" },
    { situation: "failed step", patch: { run: { runId: "run-1", status: "failed", startedAt: "2026-10-17T11:59:00Z" } }, label: "Retry" },
    { situation: "fix cap", patch: { auto: auto({ waiting: { kind: "cap", reason: "2 fix rounds used; 1 blocker remains" } }) }, label: "One more round" },
    { situation: "publication proposal", patch: {}, workflow: workflow(), label: "Review proposal" },
    { situation: "ready for review", patch: { status: "ready-for-review", prUrl: "https://github.com/acme/app/pull/1" }, label: "Review" },
    { situation: "merged but open", patch: { prState: "merged" }, label: "Finish" },
    { situation: "explicit manual task", patch: { auto: auto({ status: "paused-manual" }) }, label: "Done" },
  ])("$situation → $label", ({ patch, workflow: evidence, label }) => {
    expect(resolveNextAction({ ...base, ...patch }, evidence, now).action?.label).toBe(label);
  });

  it("shows Choose repo only for an open repo question", () => {
    const waiting = { status: "needs-you" as const, repo: "app", attention: { reason: "awaiting" as const, label: "Waiting on you", action: { kind: "open" as const, label: "Answer" as const, href: "/storyboard?task=task-1" } } };
    expect(resolveNextAction({ ...base, ...waiting }, undefined, now)).toMatchObject({ status: "Waiting on you", action: { kind: "answer", label: "Answer" } });
    expect(resolveNextAction({ ...base, ...waiting, auto: auto({ phase: "plan", waiting: { kind: "queued", reason: "Queued behind another run" } }) }, undefined, now).action?.kind).not.toBe("choose-repo");
    expect(resolveNextAction({ ...base, ...waiting, waitingOnRepo: true }, undefined, now)).toMatchObject({ status: "Choose the repo for this task", action: { kind: "choose-repo" } });
  });

  it("shows Plan ready when a duplicate plan run of the same attempt is still marked running", () => {
    const card: BoardCard = {
      ...base, status: "needs-you", repo: "app",
      attention: { reason: "awaiting", label: "Waiting on you", action: { kind: "open", label: "Answer", href: "/storyboard?task=task-1" } },
      auto: auto({ phase: "plan", planRunId: "run-plan-b", waiting: { kind: "plan-approval", reason: "Plan ready" } }),
      run: { runId: "run-plan-a", role: "plan", status: "running", startedAt: "2026-10-17T11:00:00Z" },
      steps: [{ runId: "run-plan-a", role: "plan", status: "running" }, { runId: "run-plan-b", role: "plan", status: "done" }],
    };
    expect(resolveNextAction(card, undefined, now)).toMatchObject({ status: "Plan ready", action: { kind: "approve-plan" }, needsYou: true });
    // Other live work still holds it back.
    expect(resolveNextAction({ ...card, steps: [...card.steps, { runId: "run-impl", role: "implement", status: "running" }] }, undefined, now).action?.kind).not.toBe("approve-plan");
    expect(resolveNextAction({ ...card, auto: auto({ phase: "plan", planRunId: "run-plan-a", waiting: { kind: "plan-approval", reason: "Plan ready" } }) }, undefined, now).action?.kind).not.toBe("approve-plan");
  });

  it("keeps question/failure/cap ahead of publication, review and Finish", () => {
    const card = { ...base, status: "ready-for-review" as const, prState: "merged" as const, counts: { ...base.counts, openQuestions: 2 } };
    expect(resolveNextAction(card, workflow(), now)).toMatchObject({ status: "2 questions need answers", action: { kind: "answer" } });
    expect(resolveNextAction({ ...card, counts: base.counts, auto: auto({ waiting: { kind: "failure", reason: "Build failed: exit 1" } }) }, workflow(), now)).toMatchObject({ status: "Build failed: exit 1", action: { kind: "auto-retry", label: "Retry" } });
  });

  it("does not let a merged PR or a Done note conceal queued/running work", () => {
    for (const status of ["queued", "running"]) {
      const presentation = resolveNextAction({ ...base, status: "done", prState: "merged", run: { runId: "run-1", status, startedAt: "2026-10-17T11:59:00Z" } }, undefined, now);
      expect(presentation.action?.kind).toBe("progress");
      expect(presentation.status).toContain("stop it before finishing");
    }
    expect(resolveNextAction({ ...base, status: "done", steps: [{ runId: "older-live", role: "review", status: "running" }] }, undefined, now).action?.kind).toBe("progress");
    expect(resolveNextAction({ ...base, status: "done", auto: auto({ status: "starting" }) }, undefined, now).action?.kind).toBe("progress");
  });

  it("shows Finish for note-only Done without changing task completion or note statuses", () => {
    const card = Object.freeze({ ...base, status: "done" as const });
    expect(resolveNextAction(card, undefined, now).action?.label).toBe("Finish");
    expect(card.taskDone).toBe(false);
    expect(card.status).toBe("done");
    expect(resolveNextAction({ ...card, taskDone: true }, workflow(), now).action).toBeNull();
  });

  it("never calls missing-preview QA passed, even with an older successful receipt", () => {
    expect(resolveNextAction({ ...base, status: "ready-for-review", auto: auto({ phase: "ready", noPreview: "No server" }) }, undefined, now).status).toContain("QA skipped — no preview");
  });

  it("doesn't manufacture a Retry for an external blocker or infer manual work from a title", () => {
    expect(resolveNextAction({ ...base, status: "blocked" }, undefined, now).action).toBeNull();
    expect(resolveNextAction({ ...base, title: "Small manual task" }, undefined, now).action?.kind).toBe("start-auto");
  });

  it("deduplicates attention by task, includes read proposals/review/Finish outside needs-you and ignores informational updates", () => {
    const review = { ...base, taskId: "review", status: "ready-for-review" as const };
    const finish = { ...base, taskId: "finish", prState: "merged" as const };
    const ordinary = { ...base, taskId: "ordinary" };
    const work = needsYouWork([base, base, review, finish, ordinary], [workflow(), workflow({ taskId: ordinary.taskId, proposals: [], seenRevision: 0 })], now);
    expect(work.map(({ card }) => card.taskId)).toEqual([base.taskId, "review", "finish"]);
  });
});
