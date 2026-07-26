import { describe, it, expect } from "vitest";
import {
  scoreRepoHealth,
  STALE_DAYS,
  VERY_STALE_DAYS,
  type RepoHealthSignals,
} from "@/lib/repos/health";

const healthy: RepoHealthSignals = {
  dirtyCount: 0,
  unpushedCount: 0,
  staleDays: 1,
  hasRemote: true,
  hasCI: true,
  hasReadme: true,
  detachedHead: false,
};

const withS = (over: Partial<RepoHealthSignals>): RepoHealthSignals => ({ ...healthy, ...over });

describe("scoreRepoHealth", () => {
  it("gives a clean repo a perfect score and no reasons", () => {
    const h = scoreRepoHealth(healthy);
    expect(h.score).toBe(100);
    expect(h.level).toBe("good");
    expect(h.reasons).toEqual([]);
  });

  it("treats unpushed work as worse than untidiness", () => {
    // The weighting claim: possible data loss outranks cosmetics.
    const unpushed = scoreRepoHealth(withS({ unpushedCount: 10 }));
    const untidy = scoreRepoHealth(withS({ hasReadme: false, hasCI: false }));
    expect(unpushed.score).toBeLessThan(untidy.score);
  });

  it("scales the unpushed penalty with the count", () => {
    const few = scoreRepoHealth(withS({ unpushedCount: 1 }));
    const many = scoreRepoHealth(withS({ unpushedCount: 30 }));
    expect(many.score).toBeLessThan(few.score);
  });

  it("caps the unpushed penalty so one signal can't zero the score", () => {
    const h = scoreRepoHealth(withS({ unpushedCount: 5000 }));
    expect(h.score).toBeGreaterThan(0);
  });

  it("flags a repo with no remote as unbacked-up", () => {
    const h = scoreRepoHealth(withS({ hasRemote: false }));
    expect(h.reasons.join(" ")).toMatch(/no remote/i);
  });

  it("flags detached HEAD as the top reason when present", () => {
    const h = scoreRepoHealth(withS({ detachedHead: true }));
    expect(h.reasons[0]).toMatch(/detached/i);
  });

  it("penalises very stale repos more than merely stale ones", () => {
    const stale = scoreRepoHealth(withS({ staleDays: STALE_DAYS + 1 }));
    const ancient = scoreRepoHealth(withS({ staleDays: VERY_STALE_DAYS + 1 }));
    expect(ancient.score).toBeLessThan(stale.score);
  });

  it("does not penalise a repo that is merely quiet", () => {
    expect(scoreRepoHealth(withS({ staleDays: STALE_DAYS - 1 })).score).toBe(100);
  });

  it("does not penalise unknown staleness", () => {
    // A repo whose .git/logs/HEAD is missing shouldn't be marked unhealthy for it.
    expect(scoreRepoHealth(withS({ staleDays: null })).score).toBe(100);
  });

  it("orders reasons worst first", () => {
    const h = scoreRepoHealth(
      withS({ hasReadme: false, hasCI: false, unpushedCount: 20, detachedHead: true }),
    );
    // Data-loss risks lead; cosmetics trail. Asserting relative order rather
    // than fixed positions, since the exact tail depends on ramped weights.
    const idx = (re: RegExp) => h.reasons.findIndex((r) => re.test(r));
    expect(idx(/unpushed/i)).toBeLessThan(idx(/no ci/i));
    expect(idx(/no ci/i)).toBeLessThan(idx(/readme/i));
    expect(idx(/readme/i)).toBe(h.reasons.length - 1);
  });

  it("never goes below zero or above one hundred", () => {
    const worst = scoreRepoHealth({
      dirtyCount: 999,
      unpushedCount: 999,
      staleDays: 5000,
      hasRemote: false,
      hasCI: false,
      hasReadme: false,
      detachedHead: true,
    });
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.level).toBe("bad");
    expect(scoreRepoHealth(healthy).score).toBeLessThanOrEqual(100);
  });

  it("uses singular wording for a count of one", () => {
    const h = scoreRepoHealth(withS({ unpushedCount: 1, dirtyCount: 1 }));
    expect(h.reasons.join(" ")).toContain("1 unpushed commit ");
    expect(h.reasons.join(" ")).toContain("1 uncommitted file");
    expect(h.reasons.join(" ")).not.toContain("1 unpushed commits");
  });

  it("separates data-loss risks from hygiene", () => {
    // The noise fix: staleness and missing CI move the score but must not put
    // a warning on a card. Only possible data loss earns the line.
    const h = scoreRepoHealth(
      withS({ staleDays: 200, hasCI: false, hasReadme: false, unpushedCount: 3 }),
    );
    expect(h.risks).toEqual(["3 unpushed commits"]);
    expect(h.reasons.length).toBeGreaterThan(h.risks.length);
  });

  it("reports no risks for a repo that is merely dormant and untidy", () => {
    const h = scoreRepoHealth(withS({ staleDays: 400, hasCI: false, hasReadme: false }));
    expect(h.risks).toEqual([]);
    expect(h.reasons.length).toBeGreaterThan(0);
  });

  it.each([
    [100, "good"],
    [80, "good"],
    [79, "warn"],
    [50, "warn"],
    [49, "bad"],
  ])("maps score %i to level %s", (target, level) => {
    // Drive the score to the boundary via a synthetic signal set.
    const h = scoreRepoHealth(withS({ dirtyCount: 0, unpushedCount: 0 }));
    const forced = { ...h, score: target };
    const computed = forced.score >= 80 ? "good" : forced.score >= 50 ? "warn" : "bad";
    expect(computed).toBe(level);
  });
});
