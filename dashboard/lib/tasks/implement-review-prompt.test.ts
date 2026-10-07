import { describe, expect, it } from "vitest";
import { buildImplementReviewPrompt } from "./implement-review-prompt";

const base = {
  origin: "http://127.0.0.1:1337/",
  taskId: "task-1",
  date: "2026-10-07",
  taskText: "Cap webhook retries with jitter",
  cwd: "/Users/dev/.devhub-worktrees/payments-api/pay-482",
  notePath: "pr-reviews/payments-api-pay-482",
};

describe("buildImplementReviewPrompt", () => {
  it("makes the reviewer read-only and points it at the plan and the note", () => {
    const prompt = buildImplementReviewPrompt({ ...base, repoName: "payments-api", jiraKey: "PAY-482" });
    expect(prompt).toContain("pr-explain-review skill in local pre-PR mode");
    expect(prompt).toContain("Cap webhook retries with jitter (PAY-482)");
    expect(prompt).toContain("http://127.0.0.1:1337/api/tasks/implement/plan?taskId=task-1&date=2026-10-07&repo=payments-api");
    expect(prompt).toContain(base.cwd);
    expect(prompt).toMatch(/Do not edit files, stage, commit, push/);
    expect(prompt).toContain("DevHub note pr-reviews/payments-api-pay-482");
    expect(prompt).toContain("**Task:** backlink for task id task-1 dated 2026-10-07");
  });

  it("names the branch and base only when it knows them", () => {
    expect(buildImplementReviewPrompt(base)).not.toContain("Implementation branch");
    const prompt = buildImplementReviewPrompt({ ...base, branch: "devhub/agent/pay-482", base: "origin/main" });
    expect(prompt).toContain("Implementation branch: devhub/agent/pay-482.");
    expect(prompt).toContain("Intended remote base: origin/main.");
  });

  it("omits the Jira key when there isn't one", () => {
    expect(buildImplementReviewPrompt(base)).toContain("Task: Cap webhook retries with jitter.");
  });
});
