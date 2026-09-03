import { describe, expect, it } from "vitest";
import { repoLinkMatches } from "./repo-link-match";

describe("repoLinkMatches", () => {
  it("matches local clone name and GitHub full name", () => {
    expect(repoLinkMatches("atlas", "atlas", "example-org/atlas")).toBe(true);
    expect(repoLinkMatches("example-org/atlas", "atlas", "example-org/atlas")).toBe(true);
    expect(repoLinkMatches("app-poc", "atlas", "example-org/atlas", ["app-poc"])).toBe(true);
  });

  it("rejects a different repo", () => {
    expect(repoLinkMatches("other", "atlas", "example-org/atlas")).toBe(false);
  });
});
