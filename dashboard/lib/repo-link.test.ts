import { describe, expect, it } from "vitest";
import { parseRepoLinkHref } from "./repo-link";

describe("parseRepoLinkHref", () => {
  it("parses repo-only links", () => {
    expect(parseRepoLinkHref("repo:devhub")).toEqual({ repoName: "devhub", path: undefined, line: undefined });
  });

  it("parses repo file links with line numbers", () => {
    expect(parseRepoLinkHref("repo:devhub/dashboard/app/page.tsx#L12")).toEqual({
      repoName: "devhub",
      path: "dashboard/app/page.tsx",
      line: 12,
    });
  });

  it("rejects invalid repo names", () => {
    expect(parseRepoLinkHref("repo:../devhub")).toBeNull();
  });
});
