import { describe, expect, it } from "vitest";
import { repoGitHref } from "./repo-git-href";
import { describeHref } from "./workspace-tabs";

describe("repository Git links", () => {
  it("preserves repo names and file paths containing URL delimiters", () => {
    const href = repoGitHref("demo #1", { path: "src/a #&?.ts" });
    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe("/repos/demo%20%231/git");
    expect(url.searchParams.get("path")).toBe("src/a #&?.ts");
    expect(url.searchParams.get("tab")).toBe("changes");
    expect(describeHref(href)).toEqual({ title: "demo #1", kind: "repo" });
  });

  it("routes unpushed commits to History and changed files to Changes", () => {
    expect(repoGitHref("demo", { unpushed: true })).toBe("/repos/demo/git?tab=history&unpushed=1");
    expect(repoGitHref("demo", { tab: "history", path: "file.ts" })).toBe("/repos/demo/git?tab=changes&path=file.ts");
  });

  it("opens a plain Git page without spurious search parameters", () => {
    expect(repoGitHref("demo")).toBe("/repos/demo/git");
  });
});
