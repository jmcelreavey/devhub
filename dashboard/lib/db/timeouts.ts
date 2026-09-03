/**
 * Timeout tiers for database work.
 *
 * The rule is `execExternal`'s, applied to drivers: **a ceiling is opt-out by
 * value, never by omission.** Leaving the timeout off gets you a default, and
 * there is deliberately no way to ask for none. The tier is chosen by operation
 * class rather than by the caller, the same way `repo-local.ts` picks a git
 * timeout from whether the command touches the network.
 */

/** Catalogue lookups. Fast or broken — a slow `information_schema` means trouble. */
export const DB_METADATA_TIMEOUT_MS = 15_000;

/** A query the user is sitting and waiting for. */
export const DB_QUERY_TIMEOUT_MS = 60_000;

/** The most a single interactive query may be raised to, for a known-slow report. */
export const DB_QUERY_MAX_TIMEOUT_MS = 300_000;

/** Exports and streamed runs, where the user has already accepted it will take a while. */
export const DB_STREAM_TIMEOUT_MS = 600_000;

/** Opening a socket, including TLS. Beyond this, the network is the problem. */
export const DB_CONNECT_TIMEOUT_MS = 10_000;

/** An idle pooled connection is closed after this. Cheap to reopen; not free to hold. */
export const DB_IDLE_EVICT_MS = 5 * 60_000;

/**
 * Re-resolve credentials this long before they expire.
 *
 * RDS IAM tokens last 15 minutes. Cutting it fine means a connection opened at
 * 14:59 races the expiry, so treat credentials as spent early rather than
 * discovering it as an auth failure mid-session.
 */
export const DB_CREDENTIAL_SKEW_MS = 2 * 60_000;

/** Clamp a caller-supplied timeout into the allowed range. */
export function clampQueryTimeout(requested: number | undefined): number {
  if (!requested || !Number.isFinite(requested) || requested <= 0) return DB_QUERY_TIMEOUT_MS;
  return Math.min(Math.max(requested, 1_000), DB_QUERY_MAX_TIMEOUT_MS);
}
