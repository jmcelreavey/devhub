import { describe, expect, it } from "vitest";
import { buildSearchUrl, resolveSearchMode, shouldUseSemanticSearch } from "./search-ui";

describe("search-ui", () => {
  it("enables semantic mode for multi-word queries in auto mode", () => {
    expect(shouldUseSemanticSearch("task rollover")).toBe(true);
    expect(resolveSearchMode("task rollover", "auto")).toBe("semantic");
    expect(resolveSearchMode("task", "auto")).toBe("exact");
  });

  it("builds search urls with vault and mode", () => {
    expect(buildSearchUrl("foo bar", { mode: "auto" })).toContain("mode=semantic");
    expect(buildSearchUrl("foo", { vault: "docs" })).toContain("vault=docs");
    expect(buildSearchUrl("foo", { mode: "exact" })).not.toContain("mode=");
  });
});
