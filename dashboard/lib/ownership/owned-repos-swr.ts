import { mutate } from "swr";

/** List-only key used by Repos ownership toggles and the Own detail switcher. */
export const OWNED_REPOS_SWR_KEY = "/api/own";

/** Index key — includes obligation summaries (`?summary=1`). */
export const OWNED_REPOS_SUMMARY_SWR_KEY = "/api/own?summary=1";

/**
 * True for the owned-repos list endpoints only — not `/api/own/:owner/:name/...`.
 */
export function isOwnedReposListKey(key: unknown): key is string {
  return typeof key === "string" && (key === OWNED_REPOS_SWR_KEY || key.startsWith(`${OWNED_REPOS_SWR_KEY}?`));
}

/**
 * Soft-invalidate every owned-repos list cache after claim/unclaim.
 * Repos mutates `/api/own`; Own index reads `/api/own?summary=1` — without this
 * the index stays stale until a hard refresh.
 */
export function revalidateOwnedRepos(): void {
  void mutate(isOwnedReposListKey);
}
