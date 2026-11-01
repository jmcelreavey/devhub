import { expect, it } from "vitest";
import { buildNotesBoard, type BoardSources } from "./notes-board";

it("attributes a review dispatch failure to verification after implementation succeeded", () => {
  const at = "2026-10-31T21:00:00.000Z";
  const reason = "Could not start the review: provider unavailable.";
  const sources: BoardSources = {
    tasks: [{ id: "task-1", text: "Review the change", done: false, startDate: "2026-10-31", rank: "a", createdAt: at }],
    now: Date.parse(at), doneWindowDays: null,
    noteFor: () => ({ notePath: "task-notes/task-1", view: null, modified: null }),
    runsFor: () => [{ runId: "implementation", role: "implement", status: "done", startedAt: at }],
    orchestrations: new Map([["task-1", {
      taskId: "task-1", taskDate: "2026-10-31", executionStep: "verify", status: "needs-you",
      openQuestions: 0, runCount: 1, latestRunStatus: "done", updatedAt: at, lastError: reason,
      auto: { phase: "verify", round: 0, maxRounds: 2, runs: [], waiting: { kind: "failure", reason } },
    }]]),
    jev: new Map(), errors: [],
  };
  const card = buildNotesBoard(sources).cards[0];
  expect(card.failure?.summary).toBe(`Verify failed: ${reason}`);
  expect(card.run?.status).toBe("done");
  expect(card.attention?.action.kind).toBe("auto-retry");
});
