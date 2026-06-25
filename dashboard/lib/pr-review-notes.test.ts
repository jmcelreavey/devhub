import { describe, expect, it } from "vitest";
import { prReviewNoteHref, prReviewNotePath } from "./pr-review-notes";

describe("pr-review-notes", () => {
  const row = {
    repo: "BusinessInsider/Fancy Repo",
    number: 123,
    title: "Does not matter",
    url: "https://github.com/BusinessInsider/Fancy Repo/pull/123",
  };

  it("builds a stable PR review note path", () => {
    expect(prReviewNotePath(row)).toBe("pr-reviews/businessinsider-fancy-repo-123");
  });

  it("builds the matching notes href", () => {
    expect(prReviewNoteHref(row)).toBe("/notes/pr-reviews/businessinsider-fancy-repo-123");
  });
});
