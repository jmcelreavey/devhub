import { describe, expect, it } from "vitest";
import { attentionSummary, obligationCells } from "./obligations";
import type { RepoObligations, RepoPrRadarRow } from "./types";

function obligations(overrides: Partial<RepoObligations> = {}): RepoObligations {
  return {
    defaultBranchCi: "passing",
    staleBranches: [],
    botPrs: 0,
    unassignedIssues: 0,
    partial: false,
    ...overrides,
  };
}

function pr(overrides: Partial<RepoPrRadarRow> = {}): RepoPrRadarRow {
  return {
    number: 1,
    title: "Change something",
    url: "https://github.com/acme/widgets/pull/1",
    author: { login: "alice", avatarUrl: null },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    isDraft: false,
    files: [],
    domains: [],
    team: "@acme/core",
    review: { mineRequested: false, reviewedBy: [], nobodyLooking: false, decision: null },
    checks: "passing",
    stale: false,
    uncoveredPaths: [],
    ...overrides,
  };
}

describe("obligation tones", () => {
  it("distinguishes 'we could not find out' from 'it is fine'", () => {
    // Rendering unknown as a success dot makes the strip assert a green build
    // when the GitHub call actually failed.
    const cells = obligationCells(obligations({ defaultBranchCi: "unknown", unassignedIssues: null }));
    expect(cells.find((cell) => cell.label === "Default CI")?.tone).toBe("unknown");
    expect(cells.find((cell) => cell.label === "Unassigned issues")?.tone).toBe("unknown");
  });

  it("keeps a passing build and a clean backlog green", () => {
    const cells = obligationCells(obligations());
    expect(cells.every((cell) => cell.tone === "ok")).toBe(true);
  });

  it("flags a failing build and real backlog", () => {
    const cells = obligationCells(obligations({
      defaultBranchCi: "failing",
      staleBranches: [{ name: "old", lastCommitAt: "2025-01-01T00:00:00.000Z" }],
      botPrs: 2,
      unassignedIssues: 5,
    }));
    expect(cells.map((cell) => cell.tone)).toEqual(["bad", "bad", "bad", "bad"]);
  });

  it("keeps pending CI visible instead of presenting it as passing", () => {
    const [ci] = obligationCells(obligations({ defaultBranchCi: "pending" }));
    expect(ci?.tone).toBe("bad");
    expect(ci?.weight).toBe(0);
  });
});

describe("attention weighting", () => {
  it("ranks a red default branch above a pile of stale branches", () => {
    // The regression this guards: 20 stale branches plus a failing build read as
    // "24 items need attention", burying the only urgent one.
    const staleBranches = Array.from({ length: 20 }, (_, index) => ({
      name: `old-${index}`,
      lastCommitAt: "2025-01-01T00:00:00.000Z",
    }));
    const summary = attentionSummary(obligations({ defaultBranchCi: "failing", staleBranches }), []);
    expect(summary.reasons[0]).toBe("default branch CI is failing");
    expect(summary.reasons).toContain("20 stale branches");
  });

  it("counts unattended pull requests ahead of housekeeping", () => {
    const summary = attentionSummary(
      obligations({ botPrs: 4 }),
      [pr({ review: { mineRequested: false, reviewedBy: [], nobodyLooking: true, decision: null } })],
    );
    expect(summary.reasons[0]).toBe("1 pull request with nobody looking");
  });

  it("ignores drafts, which are not waiting on anyone", () => {
    const summary = attentionSummary(
      obligations(),
      [pr({ isDraft: true, review: { mineRequested: false, reviewedBy: [], nobodyLooking: true, decision: null } })],
    );
    expect(summary.score).toBe(0);
    expect(summary.reasons).toEqual([]);
  });

  it("says nothing when there is nothing to say", () => {
    expect(attentionSummary(obligations(), [])).toEqual({ score: 0, reasons: [] });
  });

  it("does not double-count a stale PR that nobody is looking at", () => {
    const unattendedAndStale = pr({
      stale: true,
      review: { mineRequested: false, reviewedBy: [], nobodyLooking: true, decision: null },
    });
    const summary = attentionSummary(obligations(), [unattendedAndStale]);
    expect(summary.reasons).toEqual(["1 pull request with nobody looking"]);
  });
});
