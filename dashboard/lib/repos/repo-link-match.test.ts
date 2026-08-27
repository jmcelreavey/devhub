import { describe, expect, it } from "vitest";
import { repoLinkMatches } from "./repo-link-match";

describe("repoLinkMatches", () => {
  it("matches local clone name and GitHub full name", () => {
    expect(repoLinkMatches("atlas", "atlas", "businessinsider/atlas")).toBe(true);
    expect(repoLinkMatches("businessinsider/atlas", "atlas", "businessinsider/atlas")).toBe(true);
    expect(repoLinkMatches("app-poc", "atlas", "businessinsider/atlas", ["app-poc"])).toBe(true);
  });

  it("rejects a different repo", () => {
    expect(repoLinkMatches("other", "atlas", "businessinsider/atlas")).toBe(false);
  });
});
