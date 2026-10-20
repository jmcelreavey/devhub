import { describe, expect, it } from "vitest";
import { inboxLine, isUnread, sortInbox, type WorkflowInboxItem } from "./inbox";
import type { TaskWorkflow } from "./types";

const wf = (over: Partial<TaskWorkflow>): TaskWorkflow => ({ version: 1, taskId: "t", revision: 2, stage: "review", status: "waiting-user", checks: [], reviews: [], proposals: [], events: [], seenRevision: 3, ...over });
const item = (id: string, over: Partial<TaskWorkflow>): WorkflowInboxItem => ({ task: { id, text: id, done: false, createdAt: "", rank: "1" } as WorkflowInboxItem["task"], workflow: wf(over) });

describe("workflow inbox", () => {
  it("puts unread first, then the most recent activity", () => {
    const items = [
      item("old-read", { events: [{ id: "1", at: "2026-10-01T10:00:00Z", summary: "a" }] }),
      item("new-read", { events: [{ id: "2", at: "2026-10-17T10:00:00Z", summary: "b" }] }),
      item("unread", { seenRevision: 0, revision: 4, events: [{ id: "3", at: "2026-09-01T10:00:00Z", summary: "c" }] }),
    ];
    expect(sortInbox(items).map((entry) => entry.task.id)).toEqual(["unread", "new-read", "old-read"]);
    expect(isUnread(items[2].workflow)).toBe(true);
  });

  it("says stage, status and the latest update in one line", () => {
    expect(inboxLine(wf({ events: [{ id: "1", at: "", summary: "Review accepted" }] }))).toBe("Review · waiting for you — Review accepted");
    expect(inboxLine(wf({ stage: "draft-pr", status: "blocked" }))).toBe("Draft PR · blocked");
    expect(inboxLine(wf({ events: [{ id: "1", at: "", summary: "Checks passed" }, { id: "2", at: "", summary: "Updates read" }] }))).toBe("Review · waiting for you — Checks passed");
  });
});
