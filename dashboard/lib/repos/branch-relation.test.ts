import { describe, expect, it } from "vitest";
import {
  isMergedIntoDefaultBranch,
  isOnDefaultBranch,
  shouldOfferSwitchToDefault,
  shortDefaultBranchName,
} from "./branch-relation";

describe("shortDefaultBranchName", () => {
  it("strips origin/", () => {
    expect(shortDefaultBranchName("origin/main")).toBe("main");
    expect(shortDefaultBranchName("main")).toBe("main");
    expect(shortDefaultBranchName(null)).toBeNull();
  });
});

describe("isOnDefaultBranch", () => {
  it("matches local or origin-qualified names", () => {
    expect(isOnDefaultBranch("main", "origin/main")).toBe(true);
    expect(isOnDefaultBranch("origin/main", "origin/main")).toBe(true);
    expect(isOnDefaultBranch("feat", "origin/main")).toBe(false);
  });
});

describe("isMergedIntoDefaultBranch", () => {
  it("is true when not on main and nothing is ahead", () => {
    expect(
      isMergedIntoDefaultBranch({
        currentBranch: "feat",
        mainBranch: "origin/main",
        aheadMain: 0,
      }),
    ).toBe(true);
  });

  it("is false on main, when ahead, or without a default branch", () => {
    expect(
      isMergedIntoDefaultBranch({ currentBranch: "main", mainBranch: "origin/main", aheadMain: 0 }),
    ).toBe(false);
    expect(
      isMergedIntoDefaultBranch({ currentBranch: "feat", mainBranch: "origin/main", aheadMain: 2 }),
    ).toBe(false);
    expect(
      isMergedIntoDefaultBranch({ currentBranch: "feat", mainBranch: null, aheadMain: 0 }),
    ).toBe(false);
  });
});

describe("shouldOfferSwitchToDefault", () => {
  it("only offers the CTA on a merged topic branch", () => {
    expect(shouldOfferSwitchToDefault({ onMain: false, mergedIntoMain: true })).toBe(true);
    expect(shouldOfferSwitchToDefault({ onMain: true, mergedIntoMain: false })).toBe(false);
    expect(shouldOfferSwitchToDefault({ onMain: false, mergedIntoMain: false })).toBe(false);
  });
});
