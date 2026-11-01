import { describe, expect, it } from "vitest";
import { buildReviewNoteRef, matchReviewNotes, type ReviewNoteRef } from "./review-index";

function para(text: string) {
  return { type: "paragraph", content: [{ type: "text", text, styles: {} }], children: [] };
}
function link(href: string, label: string) {
  return {
    type: "paragraph",
    content: [{ type: "link", href, content: [{ type: "text", text: label, styles: {} }] }],
    children: [],
  };
}

describe("buildReviewNoteRef", () => {
  it("takes repo and PR from an embedded PR link", () => {
    const ref = buildReviewNoteRef("pr-reviews/example-org-example-api-525.json", [
      link("https://github.com/example-org/example-api/pull/525", "PR 525"),
      para("ABC-123 search"),
    ]);
    expect(ref.repo).toBe("example-api");
    expect(ref.prNumbers).toContain(525);
    expect(ref.tickets).toEqual(["ABC-123"]);
  });

  it("falls back to the filename when the note has no PR link", () => {
    const ref = buildReviewNoteRef("pr-reviews/example-org-example-api-543.json", [para("no links")]);
    expect(ref.prNumbers).toEqual([543]);
    // Org/repo can't be split reliably, so the whole prefix is kept and matched
    // by suffix later.
    expect(ref.repo).toBe("example-org-example-api");
  });

  it("handles repo names containing hyphens", () => {
    const ref = buildReviewNoteRef("pr-reviews/example-org-api-query-params-6.json", [
      link("https://github.com/example-org/api-query-params/pull/6", "PR"),
    ]);
    expect(ref.repo).toBe("api-query-params");
    expect(ref.prNumbers).toContain(6);
  });

  it("survives malformed blocks", () => {
    expect(() => buildReviewNoteRef("pr-reviews/x-1.json", null)).not.toThrow();
    expect(buildReviewNoteRef("pr-reviews/x-1.json", [{}, { content: "nope" }]).prNumbers).toEqual([
      1,
    ]);
  });
});

describe("matchReviewNotes", () => {
  const notes: ReviewNoteRef[] = [
    {
      path: "pr-reviews/example-org-example-api-525.json",
      title: "example-org-example-api-525",
      repo: "example-api",
      prNumbers: [525],
      tickets: ["ABC-123"],
    },
    {
      path: "pr-reviews/example-org-other-service-38.json",
      title: "example-org-other-service-38",
      repo: "other-service",
      prNumbers: [38],
      tickets: ["XYZ-456"],
    },
  ];

  it("matches a squash PR number within the same repo", () => {
    const m = matchReviewNotes(notes, "example-api", "ABC-123 - Improve search (#525)");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ confidence: "pr", via: "#525" });
  });

  it("matches on ticket when there is no PR number", () => {
    const m = matchReviewNotes(notes, "example-api", "ABC-123 - Improve search results");
    expect(m[0]).toMatchObject({ confidence: "ticket", via: "ABC-123" });
  });

  it("labels a cross-repo ticket hit as related, not as the review", () => {
    // The exact false positive the prototype produced: a XYZ-456 commit in example-api
    // pulling in a review note about other-service.
    const m = matchReviewNotes(notes, "example-api", "XYZ-456: Support grouped results (#539)");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ confidence: "related", via: "XYZ-456" });
  });

  it("does not match a PR number belonging to another repo", () => {
    // #38 exists, but as a other-service PR — a example-api commit numbered 38 is unrelated.
    const m = matchReviewNotes(notes, "example-api", "chore: something (#38)");
    expect(m).toEqual([]);
  });

  it("prefers the PR match and does not duplicate the note via its ticket", () => {
    const m = matchReviewNotes(notes, "example-api", "ABC-123 - search (#525)");
    expect(m).toHaveLength(1);
    expect(m[0]!.confidence).toBe("pr");
  });

  it("returns nothing when the commit references nothing", () => {
    expect(matchReviewNotes(notes, "example-api", "chore: tidy imports")).toEqual([]);
  });
});
