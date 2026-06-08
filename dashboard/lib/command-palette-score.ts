/**
 * Scoring helpers for CommandPalette filtering (nav, notes, tasks, tickets, actions).
 */

export function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return 1000;
  if (t.startsWith(q)) return 500;
  if (t.includes(q)) return 250;
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length ? 50 : -1;
}

/** Lowercase a–z / 0–9 only — ignores spaces, hyphens, slashes, case (PTF-34 vs ptf34). */
export function alphanumericCompact(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Match on compact tokens so "PTF34" hits "PTF-34", "gotonotes" matches "Go to Notes",
 * and paths like "learnings/foo" match "learningsfoo" queries. Digit-first shuffles like
 * "34PTF" do not match "PTF-34" (no ordered subsequence on the compact target).
 */
export function compactTokenScore(queryRaw: string, textRaw: string): number {
  const q = alphanumericCompact(queryRaw.trim());
  const t = alphanumericCompact(textRaw);
  if (!q || !t) return 0;
  if (t === q) return 8000;
  if (t.startsWith(q)) return 6000;
  if (t.includes(q)) return 4500;
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length ? 3200 : 0;
}

export function fieldMatchScore(query: string, text: string): number {
  return Math.max(fuzzyScore(query, text), compactTokenScore(query, text));
}

/** Best score across label, path, key, status hint, etc. */
export function paletteCommandScore(query: string, parts: readonly string[]): number {
  let best = -1;
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    const s = fieldMatchScore(query, t);
    if (s > best) best = s;
  }
  return best;
}
