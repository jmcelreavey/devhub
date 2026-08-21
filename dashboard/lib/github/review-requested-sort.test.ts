import { describe, expect, it } from "vitest";
import type { GithubPrRow } from "./prs";
import {
  reviewNotePathForPr,
  reviewRequestedSortKeyMs,
  sortReviewRequestedPrs,
} from "./review-requested-sort";

function row(overrides: Partial<GithubPrRow> = {}): GithubPrRow {
  return {
    number: 1,
    title: "older",
    url: "https://github.com/acme/app/pull/1",
    repo: "acme/app",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("reviewNotePathForPr", () => {
  it("matches the pr-reviews vault convention", () => {
    expect(reviewNotePathForPr({ repo: "acme/app", number: 1 })).toBe("pr-reviews/acme-app-1.json");
  });
});

describe("reviewRequestedSortKeyMs", () => {
  it("uses PR createdAt when there is no note", () => {
    expect(reviewRequestedSortKeyMs("2026-01-01T00:00:00Z", undefined)).toBe(
      Date.parse("2026-01-01T00:00:00Z"),
    );
  });

  it("uses the newer of createdAt and note activity", () => {
    const created = Date.parse("2026-01-01T00:00:00Z");
    const note = Date.parse("2026-08-18T12:00:00Z");
    expect(reviewRequestedSortKeyMs("2026-01-01T00:00:00Z", note)).toBe(note);
    expect(reviewRequestedSortKeyMs("2026-08-18T12:00:00Z", created)).toBe(
      Date.parse("2026-08-18T12:00:00Z"),
    );
  });

  it("treats a missing createdAt as 0 so a note still wins", () => {
    expect(reviewRequestedSortKeyMs(undefined, 50)).toBe(50);
    expect(reviewRequestedSortKeyMs(undefined, undefined)).toBe(0);
  });
});

describe("sortReviewRequestedPrs", () => {
  it("floats a newly created PR above an older one", () => {
    const older = row({ number: 1, createdAt: "2026-01-01T00:00:00Z" });
    const newer = row({ number: 2, createdAt: "2026-08-01T00:00:00Z" });
    expect(sortReviewRequestedPrs([older, newer], new Map()).map((r) => r.number)).toEqual([2, 1]);
  });

  it("floats a PR whose review note was just updated", () => {
    const stale = row({ number: 10, createdAt: "2026-08-01T00:00:00Z" });
    const touched = row({ number: 1, createdAt: "2026-01-01T00:00:00Z" });
    const notes = new Map([["pr-reviews/acme-app-1.json", Date.parse("2026-08-18T12:00:00Z")]]);
    expect(sortReviewRequestedPrs([stale, touched], notes).map((r) => r.number)).toEqual([1, 10]);
  });

  it("keeps PRs with no note ordered by created date", () => {
    const a = row({ number: 3, createdAt: "2026-03-01T00:00:00Z" });
    const b = row({ number: 4, createdAt: "2026-02-01T00:00:00Z" });
    expect(sortReviewRequestedPrs([b, a], new Map()).map((r) => r.number)).toEqual([3, 4]);
  });

  it("tie-breaks on repo then number so equal keys stay deterministic", () => {
    const a = row({ number: 2, repo: "acme/app", createdAt: "2026-01-01T00:00:00Z" });
    const b = row({ number: 1, repo: "acme/app", createdAt: "2026-01-01T00:00:00Z" });
    expect(sortReviewRequestedPrs([a, b], new Map()).map((r) => r.number)).toEqual([1, 2]);
  });
});
