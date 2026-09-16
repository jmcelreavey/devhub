import { describe, expect, it } from "vitest";
import { agentPipelineInvestigatePrompt } from "./pr-pipeline-prompt";

describe("agentPipelineInvestigatePrompt", () => {
  it("names the skill and PR URL", () => {
    const prompt = agentPipelineInvestigatePrompt("https://github.com/acme/demo/pull/1");
    expect(prompt).toContain("devhub-fix-pipeline");
    expect(prompt).toContain("https://github.com/acme/demo/pull/1");
    expect(prompt).toContain("push");
  });

  it("includes the notes path when provided", () => {
    expect(agentPipelineInvestigatePrompt("https://github.com/acme/demo/pull/1", "pr-reviews/acme-demo-1")).toContain(
      "pr-reviews/acme-demo-1",
    );
  });
});
