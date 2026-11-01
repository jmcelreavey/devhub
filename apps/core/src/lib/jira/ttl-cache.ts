/**
 * Small in-process cache for slow, rarely-changing lookups.
 *
 * Stores the promise, so callers that arrive while a load is in flight share it
 * instead of repeating the request. A failed load is dropped straight away: an
 * error must never be served back for the rest of the TTL.
 */
export interface TtlCache<T> {
  get(key: string, load: () => Promise<T>): Promise<T>;
  /** Drop one entry, or everything when no key is given. */
  invalidate(key?: string): void;
}

export function createTtlCache<T>(ttlMs: number, now: () => number = () => Date.now()): TtlCache<T> {
  const entries = new Map<string, { value: Promise<T>; expiresAt: number }>();
  return {
    get(key, load) {
      const hit = entries.get(key);
      if (hit && hit.expiresAt > now()) return hit.value;
      const value = load();
      const entry = { value, expiresAt: now() + ttlMs };
      entries.set(key, entry);
      value.catch(() => {
        // Only remove our own entry: a newer load may already have replaced it.
        if (entries.get(key) === entry) entries.delete(key);
      });
      return value;
    },
    invalidate(key) {
      if (key === undefined) entries.clear();
      else entries.delete(key);
    },
  };
}
