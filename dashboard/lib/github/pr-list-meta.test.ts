import { describe, expect, it } from "vitest";
import { checksFromMetaNode, isApprovedMetaNode } from "./prs";

describe("isApprovedMetaNode", () => {
  it("accepts reviewDecision APPROVED", () => {
    expect(isApprovedMetaNode({ reviewDecision: "APPROVED" })).toBe(true);
  });

  it("accepts a standing writer approval without reviewDecision", () => {
    expect(
      isApprovedMetaNode({
        reviewDecision: null,
        latestOpinionatedReviews: { nodes: [{ state: "APPROVED" }] },
      }),
    ).toBe(true);
  });

  it("rejects when changes are still requested", () => {
    expect(
      isApprovedMetaNode({
        reviewDecision: "CHANGES_REQUESTED",
        latestOpinionatedReviews: {
          nodes: [{ state: "APPROVED" }, { state: "CHANGES_REQUESTED" }],
        },
      }),
    ).toBe(false);
  });
});

describe("checksFromMetaNode", () => {
  it("summarizes head-commit count buckets", () => {
    const result = checksFromMetaNode({
      commits: {
        nodes: [
          {
            commit: {
              statusCheckRollup: {
                state: "FAILURE",
                contexts: {
                  checkRunCountsByState: [
                    { state: "SUCCESS", count: 1 },
                    { state: "FAILURE", count: 1 },
                  ],
                  statusContextCountsByState: [],
                },
              },
            },
          },
        ],
      },
    });
    expect(result.checks).toBe("failing");
    expect(result.checkCounts).toEqual({ passed: 1, failed: 1, pending: 0 });
  });

  it("reports none when the PR has no rollup", () => {
    expect(checksFromMetaNode({}).checks).toBe("none");
  });
});
