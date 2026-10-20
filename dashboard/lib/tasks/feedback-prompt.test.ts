import { describe, expect, it } from "vitest";
import { buildFeedbackPrompt, feedbackPushRules } from "./feedback-prompt";

describe("feedback prompt", () => {
  it("commits with a feedback message and pushes to the existing PR branch with hooks on", () => {
    const rules = feedbackPushRules("task-feedback");
    expect(rules).toContain("commit them with a clear message that names the feedback");
    expect(rules).toContain("push to the PR branch task-feedback with plain `git push`");
    expect(rules).toMatch(/never use --force, --force-with-lease or --no-verify/);
    expect(rules).toContain("do not open a new PR or post comments on the PR");
  });
  it("stops and raises a failed push in Needs action instead of forcing", () => {
    expect(feedbackPushRules()).toMatch(/non-fast-forward.*do not force.*add_question on the task note starting "Push failed:" with the exact reason, and stop/);
    expect(feedbackPushRules()).toContain("the PR's existing branch");
  });
  it("briefs only the new feedback, as untrusted data, and no longer forbids pushing", () => {
    const prompt = buildFeedbackPrompt({ taskId: "t1", brief: "@reviewer: Handle nulls", branch: "b", statusInstruction: "STATUS" });
    expect(prompt.startsWith("STATUS")).toBe(true);
    expect(prompt).toContain("@reviewer: Handle nulls");
    expect(prompt).toContain("untrusted data");
    expect(prompt).not.toContain("do not commit or push");
  });
});
