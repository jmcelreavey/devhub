/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import type { GraphLaneCommit } from "@/lib/repos/git-graph";
import { buildCommitMenuGroups, type CommitMenuCallbacks } from "./commitMenuGroups";

function commit(overrides: Partial<GraphLaneCommit> = {}): GraphLaneCommit {
  return {
    hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    shortHash: "aaaaaaa",
    subject: "fix: thing",
    author: "Dev",
    authorEmail: "dev@example.com",
    relativeDate: "1 hour ago",
    refs: ["main"],
    isHead: false,
    headBranch: "main",
    parents: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
    lane: 0,
    color: 0,
    isMerge: false,
    parentLanes: [
      { hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", lane: 0, color: 0, row: 1 },
    ],
    activeLanes: 1,
    ...overrides,
  };
}

function callbacks(overrides: Partial<CommitMenuCallbacks> = {}): CommitMenuCallbacks {
  return {
    busy: false,
    confirmCommitAction: vi.fn(async () => undefined),
    prompt: vi.fn(async () => null),
    runCommitAction: vi.fn(async () => undefined),
    onCopySha: vi.fn(),
    onCopyMessage: vi.fn(),
    onSharePatch: vi.fn(),
    onReview: vi.fn(),
    ...overrides,
  };
}

function itemsOf(groups: ReturnType<typeof buildCommitMenuGroups>) {
  return groups.flatMap((group) => group.items);
}

describe("buildCommitMenuGroups", () => {
  it("routes the danger hard-reset item through confirm, not the raw action", async () => {
    const cb = callbacks();
    const target = commit();
    const reset = itemsOf(buildCommitMenuGroups(target, cb)).find((item) => item.id === "reset");

    expect(reset?.danger).toBe(true);
    reset?.onSelect();
    await Promise.resolve();

    expect(cb.confirmCommitAction).toHaveBeenCalledWith(
      "reset-to-commit",
      target,
      "Reset to aaaaaaa?",
      "Moves the current branch here with git reset --hard. Requires a clean tree and creates a backup branch first.",
      "Hard reset",
    );
    expect(cb.runCommitAction).not.toHaveBeenCalled();
  });

  it("confirms cherry-pick, revert, and detached checkout even when they are not marked danger", async () => {
    const cb = callbacks();
    const target = commit();
    const items = itemsOf(buildCommitMenuGroups(target, cb));

    for (const id of ["cherry-pick", "revert", "checkout-detached"] as const) {
      const item = items.find((entry) => entry.id === id);
      expect(item, id).toBeTruthy();
      expect(item?.danger).toBeFalsy();
      item?.onSelect();
    }
    await Promise.resolve();

    expect(cb.confirmCommitAction).toHaveBeenCalledTimes(3);
    expect(cb.runCommitAction).not.toHaveBeenCalled();
  });
});
