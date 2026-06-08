import { deleteGist } from "@/lib/share/gist";
import { listShares, removeShare } from "@/lib/share/share-store";
import { shareExpiresAt } from "@/lib/share/share-public";

/** How often the background sweep checks for expired live links. */
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Delete every live link past its TTL: drop the gist, then forget the record.
 * Gist deletion runs first so a failure leaves the record for the next sweep
 * (deleteGist already treats an already-deleted gist as success). Returns the
 * count actually expired.
 */
export async function sweepExpiredShares(now: number = Date.now()): Promise<number> {
  const expired = listShares().filter((s) => now >= shareExpiresAt(s));
  let removed = 0;
  for (const share of expired) {
    try {
      await deleteGist(share.gistId);
      await removeShare(share.vault, share.path);
      removed += 1;
    } catch (err) {
      console.error("[share-expiry] failed to expire", share.key, err);
    }
  }
  return removed;
}

let started = false;

/** Start the in-process expiry sweep. Safe to call once on server boot. */
export function startShareExpiry(): void {
  if (started) return;
  started = true;
  void sweepExpiredShares();
  const timer = setInterval(() => void sweepExpiredShares(), SWEEP_INTERVAL_MS);
  // Don't keep the event loop alive solely on this timer.
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as unknown as { unref: () => void }).unref();
  }
}
