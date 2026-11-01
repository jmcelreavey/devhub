/**
 * Deduplicate an array of records by the value at `key`, keeping the first
 * occurrence. Items whose key is falsy are dropped.
 *
 * Used everywhere we collect PR rows from multiple sources and need a single
 * authoritative list before slicing.
 */
export function dedupeBy<T, K extends keyof T>(rows: T[], key: K): T[] {
  const seen = new Set<T[K]>();
  const out: T[] = [];
  for (const r of rows) {
    const v = r[key];
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(r);
  }
  return out;
}
