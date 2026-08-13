import { describe, expect, it } from "vitest";
import { laneColor, layoutCommitGraph, openBoundary } from "@/lib/repos/git-graph";
import type { GraphCommitRaw } from "@/lib/repos/git-parsers";

/**
 * Build a graph from a compact `[hash, "parent parent"]` description. Commits
 * must be listed newest first, as `git log --date-order` emits them.
 */
function graph(spec: [string, string][]): GraphCommitRaw[] {
  return spec.map(([hash, parents]) => ({
    hash,
    shortHash: hash.slice(0, 7),
    parents: parents.trim() ? parents.trim().split(/\s+/) : [],
    subject: hash,
    author: "me",
    authorEmail: "me@example.com",
    relativeDate: "2 hours ago",
    refs: [],
    isHead: false,
    headBranch: null,
  }));
}

describe("layoutCommitGraph", () => {
  it("keeps a linear history in one lane", () => {
    const layout = layoutCommitGraph(graph([["a", "b"], ["b", "c"], ["c", ""]]));
    expect(layout.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(layout[0]?.activeLanes).toBe(1);
  });

  it("puts a second tip in its own lane and reclaims it at the fork point", () => {
    const layout = layoutCommitGraph(
      graph([["a", "c"], ["b", "c"], ["c", "d"], ["d", ""]]),
    );
    expect(layout.map((r) => r.lane)).toEqual([0, 1, 0, 0]);
    expect(layout[0]?.activeLanes).toBe(2);
  });

  it("reuses a freed lane rather than opening a new one", () => {
    // b's lane is released where it converges on c. e is a fresh tip appearing
    // while lane 0 is still held by the mainline, so it must take the recycled
    // lane 1. The old allocator only ever released a lane at a root commit —
    // which does not occur inside a page — so this widened the rail forever.
    const layout = layoutCommitGraph(
      graph([["a", "c"], ["b", "c"], ["c", "d"], ["e", ""], ["d", ""]]),
    );
    expect(layout[3]?.lane).toBe(1);
    expect(layout[0]?.activeLanes).toBe(2);
  });

  it("opens a lane for the second parent of a merge and closes it on convergence", () => {
    const layout = layoutCommitGraph(
      graph([["m", "p1 p2"], ["p1", "r"], ["p2", "r"], ["r", ""]]),
    );
    expect(layout[0]?.isMerge).toBe(true);
    expect(layout[0]?.parentLanes.map((p) => p.lane)).toEqual([0, 1]);
    expect(layout[1]?.lane).toBe(0);
    expect(layout[2]?.lane).toBe(1);
    // Both sides reach r, which lands in the lower of the two claimed lanes.
    expect(layout[3]?.lane).toBe(0);
    expect(layout[0]?.activeLanes).toBe(2);
  });

  it("handles an octopus merge", () => {
    const layout = layoutCommitGraph(
      graph([["m", "p1 p2 p3"], ["p1", ""], ["p2", ""], ["p3", ""]]),
    );
    expect(layout[0]?.parentLanes.map((p) => p.lane)).toEqual([0, 1, 2]);
    expect(layout[0]?.activeLanes).toBe(3);
  });

  it("does not open two lanes when one branch is merged twice", () => {
    // m1 and m2 both merge p2. The second merge should find the lane already
    // waiting rather than adding a column that renders as a duplicate line.
    const layout = layoutCommitGraph(
      graph([["m1", "a p2"], ["a", "p2"], ["p2", ""]]),
    );
    expect(layout[0]?.activeLanes).toBe(2);
  });

  it("marks a parent that falls outside the page", () => {
    const layout = layoutCommitGraph(graph([["a", "offpage"]]));
    // row: null is what tells the renderer to run the line off the bottom edge
    // instead of drawing a stub that stops in empty space.
    expect(layout[0]?.parentLanes[0]).toMatchObject({
      hash: "offpage",
      lane: 0,
      row: null,
    });
  });

  it("resolves parent rows so an edge knows where to land", () => {
    const layout = layoutCommitGraph(graph([["a", "b"], ["b", ""]]));
    expect(layout[0]?.parentLanes[0]?.row).toBe(1);
  });

  it("gives every commit on one branch the same colour", () => {
    const layout = layoutCommitGraph(graph([["a", "b"], ["b", "c"], ["c", ""]]));
    expect(new Set(layout.map((r) => r.color)).size).toBe(1);
  });

  it("gives a merged-in branch a different colour from the mainline", () => {
    const layout = layoutCommitGraph(graph([["m", "p1 p2"], ["p1", ""], ["p2", ""]]));
    expect(layout[1]?.color).not.toBe(layout[2]?.color);
  });

  it("keeps a branch's colour across a lane it holds throughout", () => {
    const layout = layoutCommitGraph(
      graph([["a", "c"], ["b", "b2"], ["b2", "c"], ["c", ""]]),
    );
    // b and b2 are the same branch in lane 1 and must not change colour.
    expect(layout[1]?.color).toBe(layout[2]?.color);
  });

  it("reports one lane width for every row so lanes do not drift sideways", () => {
    const layout = layoutCommitGraph(
      graph([["m", "p1 p2"], ["p1", "r"], ["p2", "r"], ["r", ""]]),
    );
    expect(new Set(layout.map((r) => r.activeLanes)).size).toBe(1);
  });

  it("carries the head decoration through to the row", () => {
    const [commit] = graph([["a", ""]]);
    const layout = layoutCommitGraph([{ ...commit!, isHead: true, headBranch: "main" }]);
    expect(layout[0]).toMatchObject({ isHead: true, headBranch: "main" });
  });

  it("returns an empty layout for no commits", () => {
    expect(layoutCommitGraph([])).toEqual([]);
  });
});

describe("laneColor", () => {
  it("returns a concrete hex colour, not a theme variable", () => {
    // Theme variables collided: --accent and --success are both green in
    // several themes, which is why neighbouring lanes were indistinguishable.
    expect(laneColor(0)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("gives neighbouring colour indices different colours", () => {
    expect(laneColor(0)).not.toBe(laneColor(1));
    expect(laneColor(1)).not.toBe(laneColor(2));
  });

  it("wraps around instead of returning undefined", () => {
    expect(laneColor(64)).toBe(laneColor(0));
    expect(laneColor(-1)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("openBoundary", () => {
  it("returns parents with no row in the page", () => {
    expect(openBoundary(graph([["a", "b"], ["b", "c d"]])).sort()).toEqual(["c", "d"]);
  });

  it("is empty once the walk reaches a root", () => {
    expect(openBoundary(graph([["a", "b"], ["b", ""]]))).toEqual([]);
  });

  it("does not repeat a parent shared by two commits", () => {
    expect(openBoundary(graph([["a", "z"], ["b", "z"]]))).toEqual(["z"]);
  });
});
