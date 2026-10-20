import type { GithubPrRow } from "@/lib/github/prs";

export interface ReviewNoteSummary {
  path: string;
  title: string;
  repo: string | null;
  prNumbers: number[];
}

export interface ReviewedPr {
  pr: GithubPrRow;
  note: ReviewNoteSummary;
}

/** `org/app` and `app` name the same repo; notes recorded from a filename only know the short form. */
function sameRepo(prRepo: string, noteRepo: string): boolean {
  const left = prRepo.toLowerCase();
  const right = noteRepo.toLowerCase();
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`) || left.replace("/", "-") === right;
}

/** PRs someone else raised and asked John to review that already have a review note, newest note first. */
export function reviewedPrs(reviews: readonly GithubPrRow[], notes: readonly ReviewNoteSummary[]): ReviewedPr[] {
  const out: ReviewedPr[] = [];
  for (const pr of reviews) {
    const note = notes.find((candidate) => candidate.repo && candidate.prNumbers.includes(pr.number) && sameRepo(pr.repo, candidate.repo));
    if (note) out.push({ pr, note });
  }
  return out;
}
