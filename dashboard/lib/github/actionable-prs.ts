import type { GithubPrRow } from "./prs";

export function prIdentity(pr: Pick<GithubPrRow, "repo" | "number">): string {
  return `${pr.repo.toLowerCase()}#${pr.number}`;
}

export function requestedPeerReviews(reviews: readonly GithubPrRow[], authored: readonly GithubPrRow[] = []): GithubPrRow[] {
  const seen = new Set(authored.map(prIdentity));
  return reviews.filter((pr) => {
    const identity = prIdentity(pr);
    if (seen.has(identity) || pr.prState === "closed" || pr.prState === "merged") return false;
    seen.add(identity);
    return true;
  });
}

export function ownPrNeedsAction(pr: GithubPrRow): boolean {
  if (pr.prState === "closed" || pr.prState === "merged") return false;
  if (pr.checks === "failing" || pr.reviewDecision === "CHANGES_REQUESTED") return true;
  return !pr.draft && pr.approved === true && (pr.checks === "passing" || pr.checks === "none");
}

export function actionablePrs(authored: readonly GithubPrRow[], reviews: readonly GithubPrRow[], ownedRepos: readonly string[]) {
  const owned = new Set(ownedRepos.map((repo) => repo.toLowerCase()));
  const mine = [...new Map(authored.filter(ownPrNeedsAction).map((pr) => [prIdentity(pr), pr])).values()];
  const requested = requestedPeerReviews(reviews, authored).filter((pr) => owned.has(pr.repo.toLowerCase()));
  return { mine, reviews: requested };
}

export function actionablePrCount(authored: readonly GithubPrRow[], reviews: readonly GithubPrRow[], ownedRepos: readonly string[] = []): number {
  const actionable = actionablePrs(authored, reviews, ownedRepos);
  return actionable.mine.length + actionable.reviews.length;
}
