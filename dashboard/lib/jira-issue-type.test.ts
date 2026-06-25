import { describe, expect, it } from "vitest";
import { issueTypeForParent } from "./jira-issue-type";

describe("issueTypeForParent", () => {
  it("creates Tasks under epics and sub-tasks under normal issues", () => {
    expect(issueTypeForParent("Epic")).toBe("Task");
    expect(issueTypeForParent("Task")).toBe("Sub-task");
    expect(issueTypeForParent("Story")).toBe("Sub-task");
    expect(issueTypeForParent(undefined)).toBe("Sub-task");
  });
});
