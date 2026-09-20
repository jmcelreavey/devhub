import { describe, expect, it } from "vitest";
import { agentWorktreeDirName } from "@/lib/agent-runs/git";

const runId = "run-mu6mqsld-f2b542e8";

describe("agentWorktreeDirName", () => {
  it("keeps the run id as the suffix so resume can still find the run", () => {
    expect(
      agentWorktreeDirName(runId, "/Users/j/Developer/app", {
        repoName: "app",
        jiraKey: "PTF-4897",
      }),
    ).toBe("app-PTF-4897-run-mu6mqsld-f2b542e8");
  });

  it("falls back to a task slug when there is no ticket", () => {
    expect(
      agentWorktreeDirName(runId, "/Users/j/Developer/sample-svc", {
        title: "E2E native analytics vs Sample",
      }),
    ).toBe("sample-svc-e2e-native-analytics-vs-sample-run-mu6mqsld-f2b542e8");
  });

  it("prefers the ticket over the task title", () => {
    expect(
      agentWorktreeDirName(runId, "/Users/j/Developer/app", {
        jiraKey: "PTF-4897",
        title: "E2E native analytics vs Sample GA4",
      }),
    ).toBe("app-PTF-4897-run-mu6mqsld-f2b542e8");
  });

  it("uses the repo folder when no label is given", () => {
    expect(agentWorktreeDirName(runId, "/Users/j/Developer/app")).toBe(
      "app-run-mu6mqsld-f2b542e8",
    );
  });
});
