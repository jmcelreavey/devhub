import { describe, expect, it } from "vitest";
import { finishedTaskFeedback, type PrFeedbackSnapshot } from "./finished-task-feedback";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";

const url = "https://github.com/acme/app/pull/1";
const card = { taskDone: true, task: { completedAt: "2026-10-19T10:00:00Z" }, prUrl: url } as Pick<BoardCard, "taskDone" | "task" | "prUrl">;
const snapshot: PrFeedbackSnapshot = { url, state: "OPEN", self: "john", activity: [], failedChecks: [] };
const comment = { author: "reviewer", at: "2026-10-19T10:01:00Z", body: "Please fix this\nMore detail" };

describe("finished task feedback", () => {
  it("only reports new feedback after completion and caps the first line", () => {
    const result = finishedTaskFeedback(card, [{ ...snapshot, activity: [comment, { ...comment, at: "2026-10-19T10:00:00Z", body: "Old comment" }] }]);
    expect(result).toMatchObject({ action: "reopen-feedback", summary: "@reviewer: Please fix this" });
    expect(result?.brief).not.toContain("Old comment");
    expect(result?.brief).toContain("More detail");
    expect(finishedTaskFeedback(card, [{ ...snapshot, activity: [{ ...comment, body: "x".repeat(1000) }] }])?.summary.length).toBeLessThan(501);
    expect(finishedTaskFeedback(card, [{ ...snapshot, activity: Array.from({ length: 20 }, (_, index) => ({ ...comment, author: `reviewer-${index}`, body: "x".repeat(3000) })) }])?.brief.length).toBeLessThanOrEqual(4000);
  });
  it("ignores own comments, bots, missing authors and activity without timestamps", () => {
    expect(finishedTaskFeedback(card, [{ ...snapshot, activity: [{ ...comment, author: "JOHN" }, { ...comment, author: "ci[bot]" }, { ...comment, bot: true }, { ...comment, author: "" }, { ...comment, at: "" }] }])).toBeNull();
  });
  it("counts changes requested only when the review was submitted after completion", () => {
    expect(finishedTaskFeedback(card, [{ ...snapshot, activity: [{ ...comment, body: "", state: "CHANGES_REQUESTED" }] }])?.brief).toContain("Changes requested");
    expect(finishedTaskFeedback(card, [{ ...snapshot, activity: [{ ...comment, at: "2026-10-18T10:00:00Z", state: "CHANGES_REQUESTED" }] }])).toBeNull();
  });
  it("offers follow-up for merged PR comments, never reopen or a CI-only follow-up", () => {
    expect(finishedTaskFeedback(card, [{ ...snapshot, state: "MERGED", activity: [comment] }])?.action).toBe("follow-up");
    expect(finishedTaskFeedback(card, [{ ...snapshot, state: "MERGED", failedChecks: [{ name: "test", at: comment.at }] }])).toBeNull();
  });
  it("dismisses handled merged feedback but notices later comments", () => {
    const merged = { ...snapshot, state: "MERGED", activity: [comment] };
    const feedback = finishedTaskFeedback(card, [merged])!;
    const handled = { ...card, links: [{ kind: "task" as const, id: "follow-up", label: `Feedback follow-up ${feedback.key}` }] };
    expect(finishedTaskFeedback(handled, [merged])).toBeNull();
    expect(finishedTaskFeedback(handled, [{ ...merged, activity: [...merged.activity, { ...comment, at: "2026-10-19T11:00:00Z", body: "One more thing" }] }])?.action).toBe("follow-up");
  });
  it("only counts failing checks with a transition after completion", () => {
    expect(finishedTaskFeedback(card, [{ ...snapshot, failedChecks: [{ name: "test", at: comment.at }] }])?.brief).toBe("Failing check: test");
    expect(finishedTaskFeedback(card, [{ ...snapshot, failedChecks: [{ name: "test", at: "2026-10-18T10:00:00Z" }] }])).toBeNull();
  });
  it("does not guess from PR updatedAt, closed PRs, open tasks or missing completion dates", () => {
    expect(finishedTaskFeedback({ ...card, taskDone: false }, [{ ...snapshot, activity: [comment] }])).toBeNull();
    expect(finishedTaskFeedback(card, [{ ...snapshot, state: "CLOSED", activity: [comment] }])).toBeNull();
    expect(finishedTaskFeedback({ ...card, task: undefined }, [{ ...snapshot, activity: [comment] }])).toBeNull();
  });
});
