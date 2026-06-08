import { describe, it, expect } from "vitest";
import {
  normalizeGithubRemote,
  parseRepoFullNameFromApiUrl,
  parseRepoFullNameFromPrUrl,
  parseRepoFullNameFromRemote,
} from "./github-repo-url";

describe("parseRepoFullNameFromApiUrl", () => {
  it("extracts owner/name from a Search API repository_url", () => {
    expect(
      parseRepoFullNameFromApiUrl("https://api.github.com/repos/anthropics/claude"),
    ).toBe("anthropics/claude");
  });

  it("returns '?' for missing input", () => {
    expect(parseRepoFullNameFromApiUrl(undefined)).toBe("?");
    expect(parseRepoFullNameFromApiUrl("")).toBe("?");
  });

  it("returns '?' for an unrelated URL", () => {
    expect(parseRepoFullNameFromApiUrl("https://example.com/foo/bar")).toBe("?");
  });
});

describe("parseRepoFullNameFromPrUrl", () => {
  it("extracts owner/name from a PR html_url", () => {
    expect(
      parseRepoFullNameFromPrUrl("https://github.com/anthropics/claude/pull/42"),
    ).toBe("anthropics/claude");
  });

  it("returns '?' for a non-PR URL", () => {
    expect(parseRepoFullNameFromPrUrl("https://github.com/anthropics/claude")).toBe("?");
  });
});

describe("normalizeGithubRemote", () => {
  it("converts SSH remotes to HTTPS form", () => {
    expect(normalizeGithubRemote("git@github.com:anthropics/claude.git")).toBe(
      "https://github.com/anthropics/claude",
    );
  });

  it("strips trailing .git from HTTPS remotes", () => {
    expect(normalizeGithubRemote("https://github.com/anthropics/claude.git")).toBe(
      "https://github.com/anthropics/claude",
    );
  });

  it("leaves a clean HTTPS remote alone", () => {
    expect(normalizeGithubRemote("https://github.com/anthropics/claude")).toBe(
      "https://github.com/anthropics/claude",
    );
  });
});

describe("parseRepoFullNameFromRemote", () => {
  it("works for SSH and HTTPS remotes", () => {
    expect(parseRepoFullNameFromRemote("git@github.com:anthropics/claude.git")).toBe(
      "anthropics/claude",
    );
    expect(parseRepoFullNameFromRemote("https://github.com/anthropics/claude.git")).toBe(
      "anthropics/claude",
    );
  });

  it("returns null for non-github remotes", () => {
    expect(parseRepoFullNameFromRemote("https://gitlab.com/foo/bar.git")).toBeNull();
    expect(parseRepoFullNameFromRemote(null)).toBeNull();
  });
});
