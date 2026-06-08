/**
 * Tiny in-process TTL cache for async loaders.
 *
 * Usage:
 *   const loadRepos = ttlCache(() => listGithubScanRepoFullNames(), 5 * 60_000);
 *   const repos = await loadRepos();
 *
 * The loader is invoked at most once per TTL window. Failures are not cached —
 * if `load` throws, the next call retries.
 */
export interface TtlCached<T> {
  (): Promise<T>;
  invalidate(): void;
}

export function ttlCache<T>(load: () => Promise<T>, ttlMs: number): TtlCached<T> {
  let entry: { value: T; expiresAt: number } | null = null;
  let pending: Promise<T> | null = null;
  const fn = async () => {
    const now = Date.now();
    if (entry && entry.expiresAt > now) return entry.value;
    if (pending) return pending;
    pending = load().then((value) => {
      entry = { value, expiresAt: Date.now() + ttlMs };
      pending = null;
      return value;
    }, (err) => {
      pending = null;
      throw err;
    });
    const value = await pending;
    return value;
  };
  fn.invalidate = () => {
    entry = null;
  };
  return fn;
}

/**
 * Keyed variant — caches one value per key. Used where the cache key is dynamic
 * (e.g. per-repo fetch timestamps).
 */
export function ttlCacheByKey<K, V>(
  load: (key: K) => Promise<V>,
  ttlMs: number,
): (key: K) => Promise<V> {
  const map = new Map<K, { value: V; expiresAt: number }>();
  const pending = new Map<K, Promise<V>>();
  return async (key: K) => {
    const now = Date.now();
    const cached = map.get(key);
    if (cached && cached.expiresAt > now) return cached.value;
    const existing = pending.get(key);
    if (existing) return existing;
    const loading = load(key).then((value) => {
      map.set(key, { value, expiresAt: Date.now() + ttlMs });
      pending.delete(key);
      return value;
    }, (err) => {
      pending.delete(key);
      throw err;
    });
    pending.set(key, loading);
    const value = await loading;
    return value;
  };
}
