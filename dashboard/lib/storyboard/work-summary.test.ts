import { describe, expect, it } from "vitest";
import type { TaskWorkflow, WorkflowProposal } from "@/lib/workflows/types";
import type { WorkflowInboxItem } from "@/lib/workflows/inbox";
import type { BoardCard } from "./notes-board-shared";
import { resolveWorkPresentation, workflowUpdates, workSummary } from "./work-summary";

const now = Date.parse("2026-10-18T12:00:00Z");
const card = (taskId: string, patch: Partial<BoardCard> = {}): BoardCard => ({
  taskId, title: taskId, status: "todo", taskDone: false, date: "2026-10-18", notePath: `task-notes/${taskId}`, noteHref: `/notes/task-notes/${taskId}`,
  tags: [], links: [], models: [], summary: [], counts: { openQuestions: 0, openBugs: 0, blockerBugs: 0, decisions: 0 }, screenshot: null, images: [], jev: null,
  tiers: null, run: null, steps: [], updatedAt: "2026-10-18T11:00:00Z", attention: null, ...patch,
});
const proposal = (state: WorkflowProposal["state"] = "pending"): WorkflowProposal => ({ id: "p", kind: "draft-pr", runId: "run", fingerprint: "abc", contentHash: "def", destination: "acme/app", content: "PR", expiresAt: "2026-10-19T12:00:00Z", state });
const workflow = (taskId: string, patch: Partial<TaskWorkflow> = {}): TaskWorkflow => ({
  version: 1, taskId, revision: 1, seenRevision: 0, stage: "plan", status: "active", checks: [], reviews: [], proposals: [],
  events: [{ id: "e", at: "2026-10-18T11:00:00Z", summary: "Plan saved" }], ...patch,
});
const item = (taskId: string, patch: Partial<TaskWorkflow> = {}): WorkflowInboxItem => ({ task: { id: taskId, text: taskId, done: false, startDate: "2026-10-18", rank: "a0", createdAt: "2026-10-18T10:00:00Z" }, workflow: workflow(taskId, patch) });

describe("Storyboard work summary", () => {
  it("joins current-profile task IDs once, including read decisions and review outside needs-you", () => {
    const question = card("question", { counts: { openQuestions: 1, openBugs: 0, blockerBugs: 0, decisions: 0 } });
    const cards = [card("proposal"), question, card("review", { status: "ready-for-review" }), question, card("ordinary")];
    const items = [item("proposal", { seenRevision: 1, proposals: [proposal()] }), item("foreign", { proposals: [proposal()] }), { ...item("ordinary"), workflow: workflow("another-profile", { proposals: [proposal()] }) }];
    const summary = workSummary(cards, items, now);
    expect(summary.needsYou.map((entry) => entry.card.taskId)).toEqual(["question", "proposal", "review"]);
    expect([...summary.workflows.keys()]).toEqual(["proposal"]);
  });

  it("keeps Needs you independent of reading and marking informational updates", () => {
    const cards = [card("proposal"), card("info")];
    const pending = item("proposal", { proposals: [proposal()] });
    const info = item("info");
    const before = workSummary(cards, [pending, info], now);
    expect(before.needsYou).toHaveLength(1);
    expect(before.unreadUpdates).toBe(2);
    const after = workSummary(cards, [{ ...pending, workflow: { ...pending.workflow, seenRevision: 1 } }, { ...info, workflow: { ...info.workflow, seenRevision: 1 } }], now);
    expect(after.unreadUpdates).toBe(0);
    expect(after.needsYou.map((entry) => entry.card.taskId)).toEqual(before.needsYou.map((entry) => entry.card.taskId));
  });

  it("includes failed verification and independent review findings without inventing Retry for an outside blocker", () => {
    const failed = workflow("failed", { status: "blocked", checks: [{ id: "check", runId: "run", fingerprint: "abc", command: "npm test", startedAt: "", exitCode: 1, outcome: "failed", detail: "Test failed" }], proposals: [proposal()] });
    expect(resolveWorkPresentation(card("failed"), failed, now)).toMatchObject({ needsYou: true, status: "Verification failed — Test failed", action: { label: "Inspect failure" } });
    expect(resolveWorkPresentation(card("changes"), workflow("changes", { reviews: [{ runId: "review", fingerprint: "abc", verdict: "changes-requested", findings: "Fix the test", recordedAt: "" }] }), now).needsYou).toBe(true);
    expect(resolveWorkPresentation(card("external", { status: "blocked" }), workflow("external", { status: "blocked" }), now).action).toBeNull();
  });

  it("keeps questions, live work and explicit retries ahead of workflow failures", () => {
    const failed = workflow("task", { proposals: [proposal("failed")] });
    expect(resolveWorkPresentation(card("task", { counts: { openQuestions: 2, openBugs: 0, blockerBugs: 0, decisions: 0 } }), failed, now).action?.kind).toBe("answer");
    expect(resolveWorkPresentation(card("task", { run: { runId: "r", status: "running", startedAt: "2026-10-18T11:59:00Z" } }), failed, now).action?.kind).toBe("progress");
    expect(resolveWorkPresentation(card("task", { run: { runId: "r", status: "failed", startedAt: "" } }), failed, now).action?.kind).toBe("retry");
  });

  it("includes workflow review-ready but ignores stale failures and replaced publication failures", () => {
    expect(resolveWorkPresentation(card("ready"), workflow("ready", { stage: "review", status: "waiting-user" }), now)).toMatchObject({ needsYou: true, action: { kind: "review" } });
    expect(resolveWorkPresentation(card("ready"), workflow("ready", { proposals: [proposal("failed"), proposal("succeeded")] }), now).needsYou).toBe(false);
    expect(resolveWorkPresentation(card("done", { taskDone: true }), workflow("done", { proposals: [proposal()] }), now).needsYou).toBe(false);
  });
});

describe("informational Updates", () => {
  it("counts unread events, not pending actions or read bookkeeping", () => {
    const entry = item("task", { revision: 5, seenRevision: 1, events: [
      { id: "1", at: "1", summary: "Plan saved" }, { id: "2", at: "2", summary: "Verification passed" },
      { id: "3", at: "3", summary: "Approval requested: draft-pr" }, { id: "4", at: "4", summary: "Review accepted" },
      { id: "5", at: "5", summary: "Updates read" },
    ] });
    const updates = workflowUpdates([entry]);
    expect(updates.filter((update) => update.unread).map((update) => update.event.id)).toEqual(["4", "2"]);
    expect(updates.map((update) => update.event.id)).toEqual(["4", "2", "1"]);
  });

  it("preserves Mark unread and ignores action-only notifications", () => {
    const entry = item("task", { revision: 3, seenRevision: 2, events: [
      { id: "1", at: "1", summary: "Review accepted" }, { id: "2", at: "2", summary: "Updates read" }, { id: "3", at: "3", summary: "Marked unread" },
    ] });
    expect(workflowUpdates([entry])).toMatchObject([{ unread: true, event: { summary: "Review accepted" } }]);
    expect(workflowUpdates([item("action", { events: [{ id: "1", at: "1", summary: "Verification failed" }] })])).toEqual([]);
  });
});


it("shows review notes from manual and auto reviews, but keeps genuine blockers first", () => {
  const notes = { gist: "Fix the race", notes: "Fix the race", runId: "review" };
  expect(resolveWorkPresentation(card("r", { status: "needs-you", review: notes }), undefined, now).action?.label).toBe("Open review");
  expect(resolveWorkPresentation(card("r", { review: notes, counts: { openQuestions: 1, openBugs: 0, blockerBugs: 0, decisions: 0 } }), undefined, now).action?.kind).toBe("answer");
  expect(resolveWorkPresentation(card("r", { failure: { key: "key", summary: "Plan failed" } }), undefined, now).status).toBe("Plan failed");
  expect(resolveWorkPresentation(card("r", { failure: { key: "key", summary: "Plan failed", cleared: true } }), undefined, now).needsYou).toBe(false);
});
