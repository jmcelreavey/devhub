import { describe, expect, it } from "vitest";
import type { GithubPrRow } from "@/lib/github/prs";
import { reviewedPrs } from "./reviewed-prs";

const pr = (repo: string, number: number) => ({ repo, number, title: `PR ${number}`, url: `https://github.com/${repo}/pull/${number}` }) as GithubPrRow;

describe("reviewedPrs", () => {
  it("keeps only review-requested PRs that already have a review note, matching repo by short or full name", () => {
    const notes = [
      { path: "pr-reviews/app-12", title: "a", repo: "acme/app", prNumbers: [12] },
      { path: "pr-reviews/web-7", title: "b", repo: "web", prNumbers: [7] },
    ];
    const result = reviewedPrs([pr("acme/app", 12), pr("acme/web", 7), pr("acme/app", 13), pr("acme/api", 12)], notes);
    expect(result.map((item) => item.note.path)).toEqual(["pr-reviews/app-12", "pr-reviews/web-7"]);
  });
});
