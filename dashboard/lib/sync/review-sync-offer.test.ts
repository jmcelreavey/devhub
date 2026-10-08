import { describe, expect, it } from "vitest";
import { reviewSyncGitAction } from "./review-sync-offer";

describe("reviewSyncGitAction", () => {
  it("offers pull and rebuild when the checkout is behind and a rebuild can run", () => {
    expect(reviewSyncGitAction({
      behind: 2,
      dirtyCount: 0,
      conflictCount: 0,
      otherDirty: 0,
      rebuildAvailable: true,
    })).toBe("pull-and-rebuild");
  });

  it("pulls without rebuilding when rebuild is not available here", () => {
    expect(reviewSyncGitAction({
      behind: 1,
      dirtyCount: 0,
      conflictCount: 0,
      otherDirty: 0,
      rebuildAvailable: false,
    })).toBe("pull");
  });

  it("does not offer a rebuild over uncommitted work or conflicts", () => {
    const dirty = {
      behind: 2,
      dirtyCount: 1,
      conflictCount: 0,
      otherDirty: 0,
      rebuildAvailable: true,
    };
    expect(reviewSyncGitAction(dirty)).toBe("open-git");
    expect(reviewSyncGitAction({ ...dirty, dirtyCount: 0, otherDirty: 3 })).toBe("open-git");
    expect(reviewSyncGitAction({ ...dirty, dirtyCount: 0, conflictCount: 1 })).toBe("conflicts");
  });

  it("stays quiet when nothing is waiting", () => {
    expect(reviewSyncGitAction({
      behind: 0,
      dirtyCount: 0,
      conflictCount: 0,
      otherDirty: 0,
      rebuildAvailable: true,
    })).toBe("none");
  });
});
