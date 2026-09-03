import { describe, expect, it } from "vitest";
import { buildTaskImplementPrompt } from "./implement-prompt";

describe("buildTaskImplementPrompt", () => {
  it("points the skill at the encoded task plan and post-implementation gates", () => {
    const prompt = buildTaskImplementPrompt({
      origin: "http://localhost:1337/",
      taskId: "task / 1",
      date: "2026-08-25",
      repoName: "example-org/app-poc",
    });

    expect(prompt).toContain("devhub-implement-task");
    expect(prompt).toContain("example-org/app-poc");
    expect(prompt).toContain(
      "http://localhost:1337/api/tasks/implement/plan?taskId=task%20%2F%201&date=2026-08-25",
    );
    expect(prompt).toContain("tags_lookup");
    expect(prompt).toContain("Do not create a clone or worktree by default");
    expect(prompt).toContain("ask before using a worktree");
    expect(prompt).toContain("Never commit without asking");
  });

  it("pins the checkout and Jira key when the hub supplies them", () => {
    const prompt = buildTaskImplementPrompt({
      origin: "http://localhost:1337",
      taskId: "task-1",
      date: "2026-08-27",
      repoName: "app-poc",
      cwd: "/repos/app-poc",
      jiraKey: "PTF-4783",
    });
    expect(prompt).toContain("Working tree: /repos/app-poc");
    expect(prompt).toContain("Jira ticket: PTF-4783");
  });
});
