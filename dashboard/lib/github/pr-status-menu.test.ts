import { describe, expect, it } from "vitest";
import {
  buildPrStatusMenuModel,
  canonicalPrUrl,
  devhubPullRequestsHref,
  githubActionsUrl,
  githubPrChecksUrl,
} from "@/lib/github/pr-status-menu";

const target = {
  url: "https://github.com/example-org/example-service/pull/123",
  repo: "example-org/example-service",
  number: 123,
  branch: "feat/payments",
  localRepoName: "example-service",
  checks: "failing" as const,
  checkCounts: { passed: 1, failed: 2, pending: 0 },
};

function ids(overrides: Partial<typeof target> = {}) {
  return buildPrStatusMenuModel({ ...target, ...overrides }).map((item) => item.id);
}

function item(id: string, overrides: Partial<typeof target> = {}) {
  return buildPrStatusMenuModel({ ...target, ...overrides }).find((entry) => entry.id === id);
}

describe("buildPrStatusMenuModel", () => {
  it("offers GitHub, checks, Actions, copy, and DevHub links for a failing PR", () => {
    expect(ids()).toEqual([
      "open-pr",
      "open-checks",
      "open-actions",
      "copy-link",
      "copy-ref",
      "copy-branch",
      "open-devhub-repo",
      "open-devhub-prs",
    ]);
    expect(item("open-checks")?.label).toBe("Open failing checks");
    expect(item("open-checks")?.danger).toBe(true);
    expect(item("open-checks")?.description).toBe("2 failed, 1 passed, 0 pending");
    expect(item("open-checks")?.action).toEqual({
      type: "open-external",
      url: "https://github.com/example-org/example-service/pull/123/checks",
    });
    expect(item("open-actions")?.action).toEqual({
      type: "open-external",
      url: "https://github.com/example-org/example-service/actions?query=branch%3Afeat%2Fpayments",
    });
    expect(item("copy-branch")?.action).toEqual({
      type: "copy",
      text: "feat/payments",
      toastLabel: "branch name",
    });
    expect(item("open-devhub-repo")?.action).toEqual({
      type: "navigate",
      href: "/repos/example-service",
    });
    expect(item("open-devhub-prs")?.action).toEqual({
      type: "navigate",
      href: "/prs?q=example-org%2Fexample-service%20123",
    });
  });

  it("says Open checks when CI is not failing and hides branch and repo items it cannot fill", () => {
    const model = buildPrStatusMenuModel({
      url: "https://github.com/example-org/example-service/pull/9?diff=split",
      checks: "passing",
    });
    expect(model.map((entry) => entry.id)).toEqual([
      "open-pr",
      "open-checks",
      "open-actions",
      "copy-link",
      "copy-ref",
      "open-devhub-prs",
    ]);
    expect(model.find((entry) => entry.id === "open-checks")?.label).toBe("Open checks");
    expect(model.find((entry) => entry.id === "open-checks")?.danger).toBeUndefined();
    expect(model.find((entry) => entry.id === "copy-link")?.action).toEqual({
      type: "copy",
      text: "https://github.com/example-org/example-service/pull/9",
      toastLabel: "PR link",
    });
  });

  it("returns nothing for a URL that is not a GitHub pull request", () => {
    expect(buildPrStatusMenuModel({ url: "https://example.com/not-a-pr" })).toEqual([]);
    expect(canonicalPrUrl({ url: "javascript:alert(1)" })).toBeNull();
  });

  it("does not put a branch or repo slug into a URL when it is unsafe", () => {
    expect(githubActionsUrl("example-org/example-service", "-lead")).toBe(
      "https://github.com/example-org/example-service/actions",
    );
    expect(githubActionsUrl("not a repo", "main")).toBeNull();
    expect(githubPrChecksUrl({ url: "https://github.com/example-org/example-service/pull/4" })).toBe(
      "https://github.com/example-org/example-service/pull/4/checks",
    );
    expect(devhubPullRequestsHref("example-org/example-service", 4)).toBe(
      "/prs?q=example-org%2Fexample-service%204",
    );
    expect(
      buildPrStatusMenuModel({
        ...target,
        localRepoName: "../secrets",
        branch: "ok",
      }).some((entry) => entry.id === "open-devhub-repo"),
    ).toBe(false);
  });
});
