import { describe, expect, it } from "vitest";
import {
  branchPrefix,
  groupBranches,
  matchesBranchQuery,
} from "@/lib/repos/branch-grouping";

describe("branchPrefix", () => {
  it("groups on the slash convention", () => {
    expect(branchPrefix("feature/immersive-mode")).toBe("feature");
    expect(branchPrefix("sre-6557/ecr-lifecycle-cleanup")).toBe("sre-6557");
  });

  it("groups on a leading ticket prefix", () => {
    expect(branchPrefix("PTF-4356-immersive-mode-transitions")).toBe("PTF");
    expect(branchPrefix("usir-3726-remove-rdp-flag")).toBe("USIR");
  });

  it("ignores the remote segment", () => {
    // origin/feature/x belongs with feature/x, not in an "origin" bucket.
    expect(branchPrefix("origin/feature/immersive-mode")).toBe("feature");
    expect(branchPrefix("upstream/PTF-4356-thing")).toBe("PTF");
  });

  it("leaves a plain name ungrouped", () => {
    expect(branchPrefix("main")).toBe("");
    expect(branchPrefix("job-search-agent")).toBe("");
  });
});

describe("matchesBranchQuery", () => {
  it("matches a substring", () => {
    expect(matchesBranchQuery("PTF-4356-immersive-mode", "immersive")).toBe(true);
  });

  it("matches a subsequence, so initials find a long name", () => {
    expect(matchesBranchQuery("PTF-4356-immersive-mode", "p43")).toBe(true);
    expect(matchesBranchQuery("job-search-agent-match-debugger", "jsad")).toBe(true);
  });

  it("rejects a non-match", () => {
    expect(matchesBranchQuery("main", "zzz")).toBe(false);
  });

  it("treats an empty query as everything", () => {
    expect(matchesBranchQuery("anything", "   ")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesBranchQuery("PTF-4356", "ptf")).toBe(true);
  });
});

describe("groupBranches", () => {
  const names = (groups: { label: string; items: string[] }[]) =>
    groups.map((g) => [g.label, g.items]);

  it("groups families and leaves singletons flat", () => {
    const groups = groupBranches(
      ["feature/a", "feature/b", "main", "solo/only"],
      (n) => n,
    );
    // solo/ has one member, so a header would cost more than it explains.
    expect(names(groups)).toEqual([
      ["feature", ["feature/a", "feature/b"]],
      ["", ["main", "solo/only"]],
    ]);
  });

  it("orders groups by size and puts ungrouped last", () => {
    const groups = groupBranches(
      ["main", "a/1", "a/2", "b/1", "b/2", "b/3"],
      (n) => n,
    );
    expect(groups.map((g) => g.label)).toEqual(["b", "a", ""]);
  });

  it("filters before grouping", () => {
    const groups = groupBranches(["feature/alpha", "feature/beta", "main"], (n) => n, "alpha");
    expect(names(groups)).toEqual([["", ["feature/alpha"]]]);
  });

  it("returns nothing when the query matches nothing", () => {
    expect(groupBranches(["main", "feature/a"], (n) => n, "zzzz")).toEqual([]);
  });

  it("handles an empty list", () => {
    expect(groupBranches([], (n) => n)).toEqual([]);
  });

  it("works over objects, not just strings", () => {
    const groups = groupBranches(
      [{ name: "feature/a" }, { name: "feature/b" }],
      (b) => b.name,
    );
    expect(groups[0]?.items).toHaveLength(2);
  });
});
