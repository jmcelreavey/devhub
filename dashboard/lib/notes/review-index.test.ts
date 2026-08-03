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
    const ref = buildReviewNoteRef("pr-reviews/businessinsider-capi-525.json", [
      link("https://github.com/businessinsider/capi/pull/525", "PR 525"),
      para("PTF-3774 hybrid search"),
    ]);
    expect(ref.repo).toBe("capi");
    expect(ref.prNumbers).toContain(525);
    expect(ref.tickets).toEqual(["PTF-3774"]);
  });

  it("falls back to the filename when the note has no PR link", () => {
    const ref = buildReviewNoteRef("pr-reviews/businessinsider-capi-543.json", [para("no links")]);
    expect(ref.prNumbers).toEqual([543]);
    // Org/repo can't be split reliably, so the whole prefix is kept and matched
    // by suffix later.
    expect(ref.repo).toBe("businessinsider-capi");
  });

  it("handles repo names containing hyphens", () => {
    const ref = buildReviewNoteRef("pr-reviews/businessinsider-api-query-params-6.json", [
      link("https://github.com/businessinsider/api-query-params/pull/6", "PR"),
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
      path: "pr-reviews/businessinsider-capi-525.json",
      title: "businessinsider-capi-525",
      repo: "capi",
      prNumbers: [525],
      tickets: ["PTF-3774"],
    },
    {
      path: "pr-reviews/businessinsider-posts-ai-38.json",
      title: "businessinsider-posts-ai-38",
      repo: "posts-ai",
      prNumbers: [38],
      tickets: ["DP-6144"],
    },
  ];

  it("matches a squash PR number within the same repo", () => {
    const m = matchReviewNotes(notes, "capi", "PTF-3774 - Hybrid and vector search (#525)");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ confidence: "pr", via: "#525" });
  });

  it("matches on ticket when there is no PR number", () => {
    const m = matchReviewNotes(notes, "capi", "PTF-3774 - Make posts search production-ready");
    expect(m[0]).toMatchObject({ confidence: "ticket", via: "PTF-3774" });
  });

  it("labels a cross-repo ticket hit as related, not as the review", () => {
    // The exact false positive the prototype produced: a DP-6144 commit in capi
    // pulling in a review note about posts-ai.
    const m = matchReviewNotes(notes, "capi", "DP-6144: Support Categorized Questions (#539)");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ confidence: "related", via: "DP-6144" });
  });

  it("does not match a PR number belonging to another repo", () => {
    // #38 exists, but as a posts-ai PR — a capi commit numbered 38 is unrelated.
    const m = matchReviewNotes(notes, "capi", "chore: something (#38)");
    expect(m).toEqual([]);
  });

  it("prefers the PR match and does not duplicate the note via its ticket", () => {
    const m = matchReviewNotes(notes, "capi", "PTF-3774 - search (#525)");
    expect(m).toHaveLength(1);
    expect(m[0]!.confidence).toBe("pr");
  });

  it("returns nothing when the commit references nothing", () => {
    expect(matchReviewNotes(notes, "capi", "chore: tidy imports")).toEqual([]);
  });
});
