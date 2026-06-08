import { describe, expect, it } from "vitest";
import { pruneNameCount, uniquePruneNames } from "./sync-preview-utils";
import type { SyncPreviewResult } from "./sync-preview-types";

const preview: SyncPreviewResult = {
  kind: "skill",
  sourceCount: 1,
  excluded: [],
  prune: true,
  targets: [
    { tool: "codex", path: "/tmp", writes: [], prunes: ["a", "b"], unchanged: 0 },
    { tool: "claude", path: "/tmp2", writes: [], prunes: ["b", "c"], unchanged: 0 },
  ],
};

describe("sync-preview-utils", () => {
  it("uniquePruneNames dedupes across targets", () => {
    expect(uniquePruneNames(preview)).toEqual(["a", "b", "c"]);
  });

  it("pruneNameCount respects kind and prune flag", () => {
    expect(pruneNameCount(preview, "skill", true)).toBe(3);
    expect(pruneNameCount(preview, "agent", true)).toBe(0);
    expect(pruneNameCount(preview, "skill", false)).toBe(0);
  });
});
