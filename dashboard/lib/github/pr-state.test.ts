import { describe, expect, it } from "vitest";
import { countChecks, parsePrState, PR_REPO_RE } from "@/lib/github/pr-state";

describe("countChecks", () => {
  it("counts check runs and status contexts, naming failures", () => {
    const { counts, failed } = countChecks([
      { __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "SUCCESS" },
      { __typename: "CheckRun", name: "test", status: "IN_PROGRESS", conclusion: null },
      { __typename: "CheckRun", name: "e2e", status: "COMPLETED", conclusion: "FAILURE" },
      { __typename: "CheckRun", name: "docs", status: "COMPLETED", conclusion: "SKIPPED" },
      { __typename: "StatusContext", context: "ci/legacy", state: "ERROR" },
      { __typename: "StatusContext", context: "deploy", state: "PENDING" },
    ]);
    expect(counts).toEqual({ total: 6, pending: 2, passed: 1, failed: 2, skipped: 1 });
    expect(failed).toEqual(["e2e", "ci/legacy"]);
  });
});

describe("parsePrState", () => {
  it("normalises state and picks the latest submitted review", () => {
    const pr = parsePrState("acme/app", 7, {
      title: "Fix",
      state: "merged",
      reviewDecision: "",
      reviews: [
        { author: { login: "a" }, state: "COMMENTED", submittedAt: "2026-09-14T09:00:00Z" },
        { author: { login: "b" }, state: "APPROVED", submittedAt: "2026-09-14T10:00:00Z" },
        { author: { login: "c" }, state: "PENDING" },
      ],
      statusCheckRollup: null,
    });
    expect(pr).toMatchObject({
      state: "MERGED",
      reviewDecision: null,
      reviewCount: 2,
      latestReview: { author: "b", state: "APPROVED" },
      url: "https://github.com/acme/app/pull/7",
      checks: { total: 0 },
    });
  });
});

describe("PR_REPO_RE", () => {
  it("rejects values that could be read as gh flags", () => {
    expect(PR_REPO_RE.test("acme/app")).toBe(true);
    expect(PR_REPO_RE.test("--repo/x")).toBe(false);
    expect(PR_REPO_RE.test("acme")).toBe(false);
  });
});
