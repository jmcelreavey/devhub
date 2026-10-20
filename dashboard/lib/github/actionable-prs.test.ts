import { describe, expect, it } from "vitest";
import { actionablePrCount, ownPrNeedsAction, requestedPeerReviews } from "./actionable-prs";
import type { GithubPrRow } from "./prs";

const pr = (number: number, patch: Partial<GithubPrRow> = {}): GithubPrRow => ({ number, title: `PR ${number}`, repo: "acme/app", url: `https://github.com/acme/app/pull/${number}`, ...patch });

describe("actionable PRs, not inventory", () => {
  it("counts unique review requests and own PRs needing action, never all open PRs", () => {
    const authored = [pr(1), pr(2, { checks: "pending" }), pr(3, { checks: "passing" }), pr(4, { checks: "failing" }), pr(5, { reviewDecision: "CHANGES_REQUESTED" }), pr(6, { approved: true, checks: "passing" })];
    expect(actionablePrCount(authored, [pr(7), pr(7), pr(4), pr(8, { prState: "closed" })], ["acme/app"])).toBe(4);
    expect(requestedPeerReviews([pr(7), pr(7, { repo: "ACME/APP" }), pr(1)], authored).map((row) => row.number)).toEqual([7]);
  });

  it("only counts review requests in Owned repos, including bots, while keeping own action items anywhere", () => {
    const authored = [pr(1, { repo: "other/service", checks: "failing" })];
    const reviews = [pr(2), pr(2, { repo: "ACME/APP" }), pr(3, { repo: "team/elsewhere" }), pr(4, { author: { login: "dependabot[bot]" } })];
    expect(actionablePrCount(authored, reviews, ["ACME/APP"])).toBe(3);
    expect(actionablePrCount(authored, reviews, [])).toBe(1);
  });

  it("does not offer merge work on a draft or a PR still checking, or count closed/merged work", () => {
    expect(ownPrNeedsAction(pr(1, { draft: true, approved: true, checks: "passing" }))).toBe(false);
    expect(ownPrNeedsAction(pr(1, { approved: true, checks: "pending" }))).toBe(false);
    expect(ownPrNeedsAction(pr(1, { prState: "merged", checks: "failing" }))).toBe(false);
    expect(ownPrNeedsAction(pr(1, { draft: true, checks: "failing" }))).toBe(true);
  });
});
