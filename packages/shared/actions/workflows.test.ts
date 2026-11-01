import { describe, expect, it } from "vitest";
import { taskWorkflowDecide, taskWorkflowGet, taskWorkflowReview, workflowActionSchema } from "./workflows.ts";

describe("workflow action contracts", () => {
  const review = { taskId: "task-1", revision: 0, runId: "review-1", verdict: "pass", findings: "Reviewed" };

  it("keeps review as the only MCP write and retains stricter MCP run IDs", () => {
    expect(taskWorkflowReview.input.safeParse(review).success).toBe(true);
    expect(taskWorkflowReview.input.safeParse({ ...review, runId: "" }).success).toBe(false);
    expect(workflowActionSchema.safeParse({ ...review, action: "review", runId: "" }).success).toBe(true);
    expect(workflowActionSchema.safeParse(review).success).toBe(false);
    expect(taskWorkflowDecide.mcp).toHaveProperty("reason");
  });

  it("rejects unsafe task IDs in the MCP workflow read", () => {
    expect(taskWorkflowGet.input.safeParse({ taskId: "../other" }).success).toBe(false);
    expect(taskWorkflowGet.input.safeParse({ taskId: "task-1" }).success).toBe(true);
  });
});
