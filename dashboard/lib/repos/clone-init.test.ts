import { describe, expect, it } from "vitest";
import { cloneRemoteRepo, dirNameFromCloneUrl, initLocalRepo } from "@/lib/repos";

describe("dirNameFromCloneUrl", () => {
  it("takes the last path segment and strips .git", () => {
    expect(dirNameFromCloneUrl("https://github.com/org/repo.git")).toBe("repo");
    expect(dirNameFromCloneUrl("git@github.com:org/repo.git")).toBe("repo");
    expect(dirNameFromCloneUrl("https://github.com/org/repo/")).toBe("repo");
  });
});

describe("cloneRemoteRepo", () => {
  it("rejects a URL that git would read as an option", async () => {
    await expect(cloneRemoteRepo("--upload-pack=evil")).rejects.toThrow("Invalid remote URL");
  });

  it("rejects dest names that traverse or look like flags", async () => {
    await expect(cloneRemoteRepo("https://github.com/a/b.git", "../etc")).rejects.toThrow(
      "Invalid local repo name",
    );
    await expect(cloneRemoteRepo("https://github.com/a/b.git", "-evil")).rejects.toThrow(
      "Invalid local repo name",
    );
    await expect(cloneRemoteRepo("https://github.com/a/b.git", "foo/bar")).rejects.toThrow(
      "Invalid local repo name",
    );
  });
});

describe("initLocalRepo", () => {
  it("rejects dest names that traverse or look like flags", async () => {
    await expect(initLocalRepo("../etc")).rejects.toThrow("Invalid local repo name");
    await expect(initLocalRepo("-evil")).rejects.toThrow("Invalid local repo name");
    await expect(initLocalRepo("foo/bar")).rejects.toThrow("Invalid local repo name");
  });
});
