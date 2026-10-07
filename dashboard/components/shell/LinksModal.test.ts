import { describe, expect, it } from "vitest";
import { groupLinkRefs } from "@/components/shell/LinksModal";
import type { EntityRef } from "@/lib/entity-note";

describe("groupLinkRefs", () => {
  it("puts repos first, keeps kind order stable, and drops hashtags", () => {
    const refs: EntityRef[] = [
      { kind: "tag", id: "analytics", label: "#analytics" },
      { kind: "note", id: "notes/review.md", label: "Review" },
      { kind: "pr", id: "app#151", label: "App PR" },
      { kind: "repo", id: "app", label: "app" },
      { kind: "note", id: "notes/second.md", label: "Second" },
      { kind: "tag", id: "atlas", label: "#atlas" },
    ];
    expect(groupLinkRefs(refs).map((r) => r.id)).toEqual([
      "app",
      "app#151",
      "notes/review.md",
      "notes/second.md",
    ]);
  });

  it("handles an empty list", () => {
    expect(groupLinkRefs([])).toEqual([]);
  });
});
