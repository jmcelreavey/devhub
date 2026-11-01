/**
 * Fractional ranks for ordering cards inside a Storyboard column. A rank is a
 * short base-36 string compared as plain text; there is always room between
 * two ranks, so moving a card rewrites only that card's note.
 */
const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
export const RANK_RE = /^[0-9a-z]{0,63}[1-9a-z]$/;

export function isRank(value: unknown): value is string {
  return typeof value === "string" && RANK_RE.test(value);
}

function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let shared = 0;
    while ((a[shared] ?? "0") === b[shared]) shared += 1;
    if (shared > 0) return b.slice(0, shared) + midpoint(a.slice(shared), b.slice(shared));
  }
  const low = a ? DIGITS.indexOf(a[0]!) : 0;
  const high = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length;
  if (high - low > 1) return DIGITS[Math.round((low + high) / 2)]!;
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[low]! + midpoint(a.slice(1), null);
}

/** A rank strictly between `before` and `after` (either may be missing). Bad or out-of-order bounds are ignored, upper first. */
export function rankBetween(before?: string | null, after?: string | null): string {
  const low = isRank(before) ? before : "";
  let high = isRank(after) ? after : null;
  if (high !== null && low >= high) high = null;
  return midpoint(low, high);
}
