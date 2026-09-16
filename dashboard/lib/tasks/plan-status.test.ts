import { describe, expect, it } from "vitest";
import { planStatusBucket } from "@/lib/tasks/plan-status";
import type { Task } from "@/lib/tasks/types";
import type { TaskAgentRunRecord } from "@/lib/tasks/task-agent-runs";

const task = (extra: Partial<Task> = {}): Task => ({ id: "t1", text: "Do it", done: false, createdAt: "x", ...extra });
const run = (extra: Partial<TaskAgentRunRecord>): TaskAgentRunRecord => ({
  runId: "run-m1abc2-deadbeef",
  status: "done",
  startedAt: "x",
  updatedAt: "x",
  ...extra,
});

describe("planStatusBucket", () => {
  it("orders the loop: running beats everything, then PR findings", () => {
    expect(planStatusBucket(task(), run({ status: "running", prState: "merged" }), 0).bucket).toBe("running");
    const attention = { kind: "ci-failing" as const, summary: "lint", detectedAt: "x", key: "k" };
    expect(planStatusBucket(task(), run({ prState: "open", attention }), 0)).toEqual({ bucket: "needsFix", detail: "lint" });
    expect(planStatusBucket(task(), run({ prState: "merged" }), 0).bucket).toBe("mergedToClose");
    expect(planStatusBucket(task(), run({ prState: "closed" }), 0).bucket).toBe("closedToDecide");
    expect(planStatusBucket(task(), run({ prState: "open" }), 0).bucket).toBe("waitingOnMerge");
  });

  it("falls back to resumable, blocked, draft, then ready", () => {
    expect(planStatusBucket(task(), run({ status: "paused" }), 0).bucket).toBe("resumable");
    expect(planStatusBucket(task(), null, 2)).toEqual({ bucket: "blocked", detail: "2 open prerequisite(s)" });
    expect(planStatusBucket(task({ stage: "draft" }), null, 0).bucket).toBe("drafts");
    expect(planStatusBucket(task(), null, 0).bucket).toBe("readyToDispatch");
    // A finished run with no session and no PR says nothing — the task is ready again.
    expect(planStatusBucket(task(), run({ status: "done" }), 0).bucket).toBe("readyToDispatch");
  });
});
