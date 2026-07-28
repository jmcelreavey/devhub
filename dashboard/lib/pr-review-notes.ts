import type { GithubPrRow } from "@/lib/github/prs";
import { prNotePath as sharedPrNotePath } from "@/lib/pr-note";

/** Stable notes path for a PR's review — delegates to shared/pr-note. */
export function prReviewNotePath(row: GithubPrRow): string {
  return sharedPrNotePath({ repo: row.repo, number: row.number });
}

export function prReviewNoteHref(row: GithubPrRow): string {
  return `/notes/${prReviewNotePath(row).split("/").map(encodeURIComponent).join("/")}`;
}

export function prReviewNoteApiHref(row: GithubPrRow): string {
  return `/api/notes/${prReviewNotePath(row).split("/").map(encodeURIComponent).join("/")}`;
}

export const PR_REVIEW_NOTE_WATCH_EVENT = "devhub:pr-review-note-watch";

/** Tell any rendered PrReviewNoteLink for this PR to start polling for the note. */
export function notifyPrReviewNoteWatch(row: GithubPrRow): void {
  window.dispatchEvent(
    new CustomEvent(PR_REVIEW_NOTE_WATCH_EVENT, { detail: { path: prReviewNotePath(row) } }),
  );
}
