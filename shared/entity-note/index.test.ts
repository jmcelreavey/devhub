import { describe, it, expect } from "vitest";
import { buildEntityLinksSection, joinMarkdownLines, slugify } from "./index.ts";

describe("slugify", () => {
  it("slugifies and truncates", () => {
    expect(slugify("Sprint Planning!")).toBe("sprint-planning");
    expect(slugify("a".repeat(60), { maxLen: 8 })).toBe("aaaaaaaa");
  });

  it("falls back for empty input", () => {
    expect(slugify("")).toBe("untitled");
    expect(slugify("!!!", { fallback: "task" })).toBe("task");
  });
});

describe("joinMarkdownLines", () => {
  it("drops nullish entries", () => {
    expect(joinMarkdownLines(["a", null, "b", undefined])).toBe("a\nb");
  });
});

describe("buildEntityLinksSection", () => {
  it("returns empty when there are no link lines", () => {
    expect(buildEntityLinksSection([null, ""])).toBe("");
  });

  it("wraps link lines in a Links heading", () => {
    expect(buildEntityLinksSection(["::task-ref a 2026-01-01 Hello", "**Work:** [Open](/work)"])).toBe(
      ["## Links", "", "::task-ref a 2026-01-01 Hello", "**Work:** [Open](/work)", ""].join("\n"),
    );
  });
});
