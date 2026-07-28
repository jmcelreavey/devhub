import { describe, it, expect } from "vitest";
import { buildPrNoteMarkdown, prEntityId, prNotePath } from "./index.ts";

describe("pr-note", () => {
  it("builds a stable path", () => {
    expect(prNotePath({ repo: "businessinsider/syndication-services", number: 41 })).toBe(
      "pr-reviews/businessinsider-syndication-services-41",
    );
  });

  it("scaffolds with PR EntityRef", () => {
    const md = buildPrNoteMarkdown({
      repo: "org/repo",
      number: 7,
      title: "Fix the thing",
      url: "https://github.com/org/repo/pull/7",
      related: [{ kind: "task", id: "t1", label: "Ship", href: "/work?tab=tasks" }],
    });
    expect(prEntityId({ repo: "org/repo", number: 7 })).toBe("org/repo#7");
    expect(md).toContain("# Fix the thing");
    expect(md).toContain("## Links");
    expect(md).toContain("**PR:** [org/repo#7]");
    expect(md).toContain("**Task:** [Ship](/work?tab=tasks)");
  });
});
