import { mutate } from "swr";

/** Matches `/api/repos/<name>/pr` with optional `?branch=` cache-bust query. */
const REPO_OPEN_PR_KEY = /^\/api\/repos\/[^/]+\/pr(?:\?|$)/;

/**
 * Soft-invalidate open-PR SWR caches after push / local status refresh.
 * Without this, cards keep a stale `pr: null` until the long poll fires.
 */
export function revalidateRepoOpenPrs(repoName?: string): void {
  if (repoName) {
    const prefix = `/api/repos/${encodeURIComponent(repoName)}/pr`;
    void mutate((key) => typeof key === "string" && key.startsWith(prefix));
    return;
  }
  void mutate((key) => typeof key === "string" && REPO_OPEN_PR_KEY.test(key));
}
