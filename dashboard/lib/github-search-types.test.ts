import { describe, it, expect } from "vitest";
import { prStateFrom, GH_PR_JSON_FIELDS } from "./github-search-types";

describe("prStateFrom", () => {
  it("returns 'merged' when mergedAt is present", () => {
    expect(prStateFrom({ mergedAt: "2026-05-14T10:00:00Z", state: "closed" })).toBe("merged");
  });

  it("returns 'closed' when state is closed and not merged", () => {
    expect(prStateFrom({ state: "closed" })).toBe("closed");
    expect(prStateFrom({ state: "CLOSED" })).toBe("closed");
    expect(prStateFrom({ mergedAt: null, state: "closed" })).toBe("closed");
  });

  it("returns 'open' as the default fallback", () => {
    expect(prStateFrom({ state: "open" })).toBe("open");
    expect(prStateFrom({ state: "OPEN" })).toBe("open");
    expect(prStateFrom({})).toBe("open");
  });
});

describe("GH_PR_JSON_FIELDS", () => {
  it("includes every field the callers consume", () => {
    for (const required of ["mergedAt", "createdAt", "title", "url", "number", "author", "state"]) {
      expect(GH_PR_JSON_FIELDS).toContain(required);
    }
  });
});
