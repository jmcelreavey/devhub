import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import type { OrchestrationRecord } from "@/lib/storyboard/types";
const mocks = vi.hoisted(() => ({ task: vi.fn(), reopen: vi.fn(), board: vi.fn(), cache: vi.fn(), restore: vi.fn(), resume: vi.fn(), auto: vi.fn(), mutate: vi.fn(), reconcile: vi.fn(), note: vi.fn(), add: vi.fn(), runs: vi.fn() }));
vi.mock("./reopen-task", () => ({ resolveReopenTask: mocks.task, reopenTask: mocks.reopen }));
vi.mock("@/lib/notes/dir", () => ({ getActiveTasksDir: () => "/fixture/tasks" }));
vi.mock("@/lib/plugins/lock", () => ({ withPluginMutationLock: (_key: string, work: () => Promise<unknown>) => work() }));
vi.mock("@/lib/storyboard/notes-board", () => ({ readNotesBoard: mocks.board }));
vi.mock("@/lib/github/prs", () => ({ readGithubPrsListCache: mocks.cache }));
vi.mock("./feedback-worktree", () => ({ restoreFeedbackWork: mocks.restore }));
vi.mock("./resume-task-agent", () => ({ resumeTaskAgent: mocks.resume }));
vi.mock("@/lib/storyboard/orchestration-store", () => ({ readOrchestration: mocks.auto, mutateOrchestration: mocks.mutate }));
vi.mock("@/lib/storyboard/orchestrator", () => ({ reconcileOrchestration: mocks.reconcile }));
vi.mock("./task-agent-runs", () => ({ listTaskAgentRuns: mocks.runs, isActiveTaskAgentRunStatus: (status: string) => ["running", "queued"].includes(status) }));
vi.mock("@/lib/agent-runs/store", () => ({ readAgentRun: () => null }));
vi.mock("./task-note-sections", () => ({ updateTaskNoteSections: mocks.note }));
vi.mock("./storage", () => ({ addTask: mocks.add }));
import { reopenWithFeedback } from "./reopen-feedback";

const task = { id: "task", text: "Fix", done: true, completedAt: "2026-10-18T10:00:00Z", startDate: "2026-10-18", createdAt: "", rank: "a", links: [{ kind: "repo" as const, id: "acme/app", label: "app" }] };
const url = "https://github.com/acme/app/pull/1";
const card = { taskId: "task", task, taskDone: true, status: "done", prUrl: url, links: [], steps: [], run: null } as unknown as BoardCard;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.task.mockResolvedValue(task);
  mocks.reopen.mockResolvedValue({ ok: true, alreadyOpen: false, column: "ready-for-review", task: { ...task, done: false } });
  mocks.board.mockReturnValue({ cards: [card] });
  mocks.cache.mockReturnValue({ feedbackPrs: [{ url, state: "OPEN", self: "john", activity: [{ author: "reviewer", at: "2026-10-18T11:00:00Z", body: "New comment" }, { author: "reviewer", at: "2026-10-17T11:00:00Z", body: "Old comment" }], failedChecks: [] }] });
  mocks.restore.mockResolvedValue({ cwd: "/fixture/worktree" });
  mocks.resume.mockResolvedValue({ run: { id: "new-run" } });
  mocks.auto.mockReturnValue(null);
  mocks.runs.mockReturnValue([]);
  mocks.note.mockReturnValue({ view: { meta: { links: [] } } });
  mocks.add.mockResolvedValue({ id: "follow-up" });
});

describe("reopen feedback actions", () => {
  it.each([{}, { addressFeedback: true }, { followUp: true }])("refuses handed-off work before restoring or mutating anything (%o)", async (action) => {
    mocks.task.mockResolvedValue({ ...task, handoff: { handoffId: "h1", toUserId: "U2", toName: "helper", status: "accepted", expiresAt: 1 } });
    await expect(reopenWithFeedback({ taskId: "task", ...action }, "http://fixture")).rejects.toMatchObject({ status: 409 });
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.note).not.toHaveBeenCalled();
    expect(mocks.reopen).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it("plain reopen never restores or dispatches work", async () => {
    await reopenWithFeedback({ taskId: "task" }, "http://fixture");
    expect(mocks.reopen).toHaveBeenCalled();
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.resume).not.toHaveBeenCalled();
  });
  it("restores the branch first, then dispatches only the new feedback", async () => {
    await reopenWithFeedback({ taskId: "task", addressFeedback: true }, "http://fixture");
    expect(mocks.restore.mock.invocationCallOrder[0]).toBeLessThan(mocks.reopen.mock.invocationCallOrder[0]);
    expect(mocks.resume).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task", cwd: "/fixture/worktree", feedbackBrief: expect.stringContaining("@reviewer: New comment") }));
    expect(mocks.resume.mock.calls[0][0].feedbackBrief).not.toContain("Old comment");
  });
  it("never reopens merged feedback and creates a linked follow-up with those comments", async () => {
    mocks.cache.mockReturnValue({ feedbackPrs: [{ url, state: "MERGED", self: "john", activity: [{ author: "reviewer", at: "2026-10-18T11:00:00Z", body: "New comment" }], failedChecks: [] }] });
    await expect(reopenWithFeedback({ taskId: "task", addressFeedback: true }, "http://fixture")).rejects.toMatchObject({ status: 409 });
    expect((await reopenWithFeedback({ taskId: "task", followUp: true }, "http://fixture"))).toMatchObject({ followUpTaskId: "follow-up" });
    expect(mocks.reopen).not.toHaveBeenCalled();
    expect(mocks.resume).not.toHaveBeenCalled();
    expect(mocks.add).toHaveBeenCalledWith("Follow up: Fix", undefined, undefined, expect.arrayContaining([expect.objectContaining({ kind: "task", id: "task" }), expect.objectContaining({ kind: "pr", href: url })]));
    expect(mocks.note).toHaveBeenCalledWith({ taskId: "follow-up" }, { op: "set_summary", text: "@reviewer: New comment" });
  });
  it("retains auto settings and pauses after a new plan when that was requested", async () => {
    const record = { status: "ready-for-review", auto: { pauseAfterPlan: true, phase: "ready", attempt: 0, round: 1, maxRounds: 2, runs: [] }, tiers: { saved: true } } as unknown as OrchestrationRecord;
    mocks.auto.mockReturnValue(record);
    mocks.mutate.mockImplementation(async (_id, _key, change: (current: OrchestrationRecord) => OrchestrationRecord) => ({ record: change(record) }));
    mocks.reconcile.mockImplementation(async () => ({ orchestration: record }));
    await reopenWithFeedback({ taskId: "task", addressFeedback: true }, "http://fixture");
    expect(record.auto).toMatchObject({ pauseAfterPlan: true, phase: "plan", attempt: 1, maxRounds: 2, feedbackBrief: expect.stringContaining("New comment"), work: { cwd: "/fixture/worktree" } });
    expect(record.tiers).toEqual({ saved: true });
    expect(mocks.reconcile).toHaveBeenCalledWith("task");
    expect(mocks.resume).not.toHaveBeenCalled();
  });
  it("does nothing on replay and refuses live work or failed restoration before reopening", async () => {
    mocks.task.mockResolvedValueOnce({ ...task, done: false }).mockResolvedValueOnce({ ...task, done: false });
    mocks.board.mockReturnValueOnce({ cards: [{ ...card, taskDone: false }] });
    expect(await reopenWithFeedback({ taskId: "task", addressFeedback: true }, "http://fixture")).toMatchObject({ alreadyOpen: true });
    expect(mocks.resume).not.toHaveBeenCalled();
    mocks.runs.mockReturnValueOnce([{ runId: "live", status: "running" }]);
    await expect(reopenWithFeedback({ taskId: "task", addressFeedback: true }, "http://fixture")).rejects.toMatchObject({ status: 409 });
    mocks.restore.mockRejectedValueOnce(new Error("Branch unavailable"));
    await expect(reopenWithFeedback({ taskId: "task", addressFeedback: true }, "http://fixture")).rejects.toThrow("Branch unavailable");
    expect(mocks.reopen).not.toHaveBeenCalled();
  });
});
