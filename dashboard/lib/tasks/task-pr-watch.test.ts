import { describe, expect, it } from "vitest";
import { assessTaskPr, type TaskPrView } from "@/lib/tasks/task-pr-watch";
import type { TaskAgentRunRecord } from "@/lib/tasks/task-agent-runs";

const NOW = "2026-09-17T10:00:00.000Z";
const run = (extra: Partial<TaskAgentRunRecord> = {}): TaskAgentRunRecord => ({
  runId: "run-m1abc2-deadbeef",
  status: "done",
  startedAt: "2026-09-16T09:00:00.000Z",
  updatedAt: "2026-09-16T10:00:00.000Z",
  prUrl: "https://github.com/acme/app/pull/7",
  ...extra,
});
const failingCi: TaskPrView = {
  state: "OPEN",
  headRefOid: "abc",
  statusCheckRollup: [{ name: "lint", status: "COMPLETED", conclusion: "FAILURE" }],
};

describe("assessTaskPr", () => {
  it("records merged and closed without raising attention", () => {
    expect(assessTaskPr({ ...failingCi, state: "MERGED" }, run(), { now: NOW, self: "me" })).toMatchObject({
      prState: "merged",
      attention: undefined,
    });
    expect(assessTaskPr({ state: "CLOSED" }, run(), { now: NOW, self: "me" }).prState).toBe("closed");
  });

  it("flags failing CI and keeps the first detection time", () => {
    const first = assessTaskPr(failingCi, run(), { now: NOW, self: "me" });
    expect(first.attention).toMatchObject({ kind: "ci-failing", summary: "Failing checks: lint", detectedAt: NOW });
    const later = assessTaskPr(failingCi, run({ attention: first.attention }), { now: "2026-09-17T11:00:00.000Z", self: "me" });
    expect(later.attention?.detectedAt).toBe(NOW);
  });

  it("stays quiet after the finding was handled, until the head changes", () => {
    const key = assessTaskPr(failingCi, run(), { now: NOW, self: "me" }).attention!.key;
    expect(assessTaskPr(failingCi, run({ attentionHandled: key }), { now: NOW, self: "me" }).attention).toBeUndefined();
    const pushed = assessTaskPr({ ...failingCi, headRefOid: "def" }, run({ attentionHandled: key }), { now: NOW, self: "me" });
    expect(pushed.attention?.kind).toBe("ci-failing");
  });

  it("reports changes requested with the reviewer", () => {
    const patch = assessTaskPr(
      {
        state: "OPEN",
        reviewDecision: "CHANGES_REQUESTED",
        reviews: [{ author: { login: "sam" }, state: "CHANGES_REQUESTED", submittedAt: NOW, body: "Rename the flag" }],
      },
      run(),
      { now: NOW, self: "me" },
    );
    expect(patch.attention).toMatchObject({ kind: "changes-requested", summary: "@sam requested changes: Rename the flag" });
  });

  it("only counts other people's comments newer than what was seen", () => {
    const view: TaskPrView = {
      state: "OPEN",
      comments: [
        { author: { login: "me" }, createdAt: "2026-09-17T09:30:00.000Z", body: "my own note" },
        { author: { login: "sam" }, createdAt: "2026-09-17T08:00:00.000Z", body: "old comment" },
        { author: { login: "kim" }, createdAt: "2026-09-17T09:45:00.000Z", body: "Can you add a test?" },
      ],
    };
    const patch = assessTaskPr(view, run({ prSeenAt: "2026-09-17T09:00:00.000Z" }), { now: NOW, self: "me" });
    expect(patch.attention).toMatchObject({ kind: "new-comments", summary: "@kim: Can you add a test?" });
    // First sighting sets the baseline, so older comments don't alert.
    expect(assessTaskPr(view, run(), { now: NOW, self: "me" }).attention).toBeUndefined();
  });
});
