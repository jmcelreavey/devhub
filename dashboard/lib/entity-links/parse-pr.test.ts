import { describe, expect, it } from "vitest";
import { parseGithubPrRef, parseGithubPrUrl } from "./parse-pr";

describe("parseGithubPrUrl", () => {
  it("parses GitHub pull request URLs and ignores page suffixes", () => {
    expect(parseGithubPrUrl("https://github.com/businessinsider/posts-ai-content-pairing/pull/1/files?diff=split#top")).toEqual({
      repo: "businessinsider/posts-ai-content-pairing",
      number: 1,
    });
  });

  it.each([
    "https://evilgithub.com/org/repo/pull/1",
    "ftp://github.com/org/repo/pull/1",
    "https://github.com/org/repo/issues/1",
    "https://github.com/org/repo/pull/0",
    "https://github.com/org/repo/pull/not-a-number",
  ])("rejects invalid PR URL %s", (url) => {
    expect(parseGithubPrUrl(url)).toBeNull();
  });
});

describe("parseGithubPrRef", () => {
  it("parses owner/repo#number ids", () => {
    expect(parseGithubPrRef("acme/widgets#42")).toEqual({
      repo: "acme/widgets",
      number: 42,
    });
  });

  it("parses GitHub pull request URLs", () => {
    expect(parseGithubPrRef("https://github.com/acme/widgets/pull/9")).toEqual({
      repo: "acme/widgets",
      number: 9,
    });
  });

  it("rejects junk", () => {
    expect(parseGithubPrRef("not-a-pr")).toBeNull();
    expect(parseGithubPrRef("acme/widgets#0")).toBeNull();
  });
});
