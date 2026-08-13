/**
 * Grouping and filtering for branch lists.
 *
 * A team repo runs to dozens of branches and they were rendered as one flat
 * list, so finding the one you wanted meant reading every row. Branch names
 * already carry structure — `feature/x`, `PTF-4356-…`, `sre-6557/…` — and this
 * turns that convention into navigation without asking anyone to rename
 * anything.
 */

export interface BranchGroup<T> {
  /** Display label for the group; empty string for ungrouped branches. */
  label: string;
  items: T[];
}

/**
 * The part of a branch name that names its family.
 *
 * Prefers a slash, which is the explicit convention. Falls back to a leading
 * ticket prefix (`PTF-4356-immersive-mode` → `PTF`), because that is the other
 * shape these names take in practice and it groups a sprint's work together.
 * Anything else is ungrouped rather than being forced into a bucket.
 */
export function branchPrefix(name: string): string {
  const withoutRemote = name.replace(/^[^/]+\//, (match) =>
    // `origin/feature/x` should group on `feature`, not on `origin`.
    /^(origin|upstream)\//i.test(match) ? "" : match,
  );
  const slash = withoutRemote.indexOf("/");
  if (slash > 0) return withoutRemote.slice(0, slash);
  const ticket = /^([A-Za-z]{2,10})[-_]\d+/.exec(withoutRemote);
  if (ticket) return ticket[1]!.toUpperCase();
  return "";
}

/** Case-insensitive subsequence match, so "p43" finds "PTF-4356". */
export function matchesBranchQuery(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = name.toLowerCase();
  if (haystack.includes(q)) return true;
  let i = 0;
  for (const char of haystack) {
    if (char === q[i]) i += 1;
    if (i === q.length) return true;
  }
  return false;
}

/**
 * Filter then group. Groups are ordered by size so the busy families surface
 * first, and ungrouped branches come last under an empty label — `main` should
 * not be buried beneath six feature folders.
 */
export function groupBranches<T>(
  items: T[],
  getName: (item: T) => string,
  query = "",
): BranchGroup<T>[] {
  const matched = items.filter((item) => matchesBranchQuery(getName(item), query));
  const buckets = new Map<string, T[]>();
  for (const item of matched) {
    const prefix = branchPrefix(getName(item));
    buckets.set(prefix, [...(buckets.get(prefix) ?? []), item]);
  }

  const grouped: BranchGroup<T>[] = [];
  const ungrouped = buckets.get("") ?? [];
  buckets.delete("");

  for (const [label, groupItems] of buckets) {
    // A group of one is just a row with a header above it, which is worse than
    // the flat list it replaced.
    if (groupItems.length < 2) ungrouped.push(...groupItems);
    else grouped.push({ label, items: groupItems });
  }

  grouped.sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
  if (ungrouped.length > 0) grouped.push({ label: "", items: ungrouped });
  return grouped;
}
