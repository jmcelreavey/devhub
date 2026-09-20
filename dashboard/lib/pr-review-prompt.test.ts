import { describe, expect, it } from "vitest";
import { agentReviewPrompt, agentReviewSessionTitle } from "@/lib/pr-review-prompt";

describe("agentReviewSessionTitle", () => {
  it("puts the Jira key first when the PR title has one", () => {
    expect(
      agentReviewSessionTitle({
        title: "PTF-4931 Track Watch Mode video orientation",
        repo: "acme/sample-svc",
        number: 14573,
      }),
    ).toBe("PTF-4931 · sample-svc#14573");
  });

  it("falls back to repo#number when there is no ticket", () => {
    expect(
      agentReviewSessionTitle({
        title: "Track Watch Mode video orientation",
        repo: "acme/sample-svc",
        number: 14573,
      }),
    ).toBe("sample-svc#14573");
  });

  it("parses owner/repo#n from the PR URL when row fields are missing", () => {
    expect(
      agentReviewSessionTitle({
        url: "https://github.com/acme/app/pull/12",
      }),
    ).toBe("app#12");
  });
});

describe("agentReviewPrompt", () => {
  it("leads with the session title so Cursor's auto-name is not PR Explain Review", () => {
    const prompt = agentReviewPrompt(
      "https://github.com/acme/sample-svc/pull/14573",
      "pr-reviews/acme-sample-svc-14573",
      "PTF-4931 · sample-svc#14573",
    );
    expect(prompt.startsWith("PTF-4931 · sample-svc#14573\n")).toBe(true);
    expect(prompt).toContain("pr-explain-review");
    expect(prompt).toContain("Notes MCP path: pr-reviews/acme-sample-svc-14573");
  });

  it("derives repo#n from the URL when no title is passed", () => {
    const prompt = agentReviewPrompt("https://github.com/acme/app/pull/1");
    expect(prompt.startsWith("app#1\n")).toBe(true);
  });
});
