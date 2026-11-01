import { mutate } from "swr";

/** SWR key for GET /api/scripts/history (sidebar “last synced”, etc.). */
export const SCRIPTS_HISTORY_SWR_KEY = "/api/scripts/history";

/**
 * Call when a script run has finished (success or failure) so any SWR consumer
 * of run history refetches. Raw `fetch("/api/scripts/history")` does not
 * invalidate this cache.
 */
export function revalidateScriptsHistory(): void {
  void mutate(SCRIPTS_HISTORY_SWR_KEY);
}
