import { describe, expect, it } from "vitest";
import { buildCreatePrPrompt } from "./create-pr-prompt";

describe("buildCreatePrPrompt", () => {
  it("names the create-pr skill and keeps the agent in ask-first mode", () => {
    const prompt = buildCreatePrPrompt({
      repoName: "app-poc",
      jiraKey: "PTF-4783",
      taskId: "task-1",
      date: "2026-08-27",
    });
    expect(prompt).toContain("create-pr skill");
    expect(prompt).toContain("PTF-4783");
    expect(prompt).toContain("task-1");
    expect(prompt).toContain("2026-08-27");
    expect(prompt).toContain("ask any questions");
    expect(prompt).toContain("Do not silently run");
  });
});
