/**
 * Lexicographic rank strings. No random jitter: two machines inserting between
 * the same neighbours produce the same key. Ties break by task id.
 *
 * Digits sort in ASCII order. Generated keys never end in "0" (a trailing zero
 * would make the midpoint ambiguous).
 */
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ZERO = DIGITS[0]!;

function midpoint(a: string, b: string | null, digits = DIGITS): string {
  const zero = digits[0]!;
  if (b !== null && a >= b) throw new Error(`${a} >= ${b}`);
  if (a.slice(-1) === zero || (b && b.slice(-1) === zero)) {
    throw new Error("trailing zero");
  }
  if (b) {
    let n = 0;
    while ((a[n] || zero) === b[n]) n += 1;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n), digits);
    const digitA = Math.max(0, digits.indexOf(a[0] || zero));
    const digitB = digits.indexOf(b[0]!);
    if (digitB - digitA > 1) {
      const midDigit = Math.round(0.5 * (digitA + digitB));
      return digits[midDigit]!;
    }
    if (b.length > 1) return b.slice(0, 1);
    return digits[digitA]! + midpoint(a.slice(1), null, digits);
  }
  const digitA = Math.max(0, digits.indexOf(a[0] || zero));
  if (digitA < digits.length - 1) return digits[digitA + 1]!;
  return digits[digitA]! + midpoint(a.slice(1), null, digits);
}

/** A rank strictly between `before` and `after`. Either side may be null (open). */
export function rankBetween(before: string | null, after: string | null): string {
  if (before !== null && after !== null && before >= after) {
    throw new Error(`rank ${before} >= ${after}`);
  }
  return midpoint(before ?? "", after);
}

/**
 * Ranks for `orderedIds` that preserve the current order.
 * Returns only the ids whose rank must change — a single move changes one.
 */
export function changedRanks(
  current: ReadonlyArray<{ id: string; rank: string }>,
  orderedIds: readonly string[],
): Map<string, string> {
  const byId = new Map(current.map((task) => [task.id, task.rank]));
  const changes = new Map<string, string>();
  let prev: string | null = null;
  for (let i = 0; i < orderedIds.length; i += 1) {
    const id = orderedIds[i]!;
    const rank = byId.get(id);
    if (rank === undefined) throw new Error(`Unknown task ${id}`);
    let upper: string | null = null;
    for (let j = i + 1; j < orderedIds.length; j += 1) {
      const nextId = orderedIds[j]!;
      if (changes.has(nextId)) continue;
      const candidate = byId.get(nextId)!;
      if (prev === null || candidate > prev) {
        upper = candidate;
        break;
      }
    }
    const fits = (prev === null || rank > prev) && (upper === null || rank < upper);
    if (fits) {
      prev = rank;
      continue;
    }
    const next = rankBetween(prev, upper);
    changes.set(id, next);
    prev = next;
  }
  return changes;
}

export function ranksInOrder(count: number): string[] {
  const ranks: string[] = [];
  let prev: string | null = null;
  for (let i = 0; i < count; i += 1) {
    const rank = rankBetween(prev, null);
    ranks.push(rank);
    prev = rank;
  }
  return ranks;
}

export { ZERO as RANK_ZERO };
