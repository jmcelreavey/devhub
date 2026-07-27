import { describe, expect, it } from "vitest";
import { creationParentForLinkedIssue, issueTypeForParent } from "@/lib/jira/issue-type";

describe("issueTypeForParent", () => {
  it("creates Tasks under epics and sub-tasks under normal issues", () => {
    expect(issueTypeForParent("Epic")).toBe("Task");
    expect(issueTypeForParent("Task")).toBe("Sub-task");
    expect(issueTypeForParent("Story")).toBe("Sub-task");
    expect(issueTypeForParent(undefined)).toBe("Sub-task");
  });
});

it("creates linked work as a sibling under the same parent", () => {
  expect(creationParentForLinkedIssue({ key: "PTF-4102", parent: { key: "PTF-3896", issuetype: "Epic" } })).toEqual({ key: "PTF-3896", issuetype: "Epic" });
});
