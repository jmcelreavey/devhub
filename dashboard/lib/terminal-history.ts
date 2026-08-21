/**
 * Terminal command history for the prompt bar — ↑/↓ navigation and ⌃R fuzzy
 * search. Client-safe: localStorage, capped, deduped.
 */

const HISTORY_KEY = "devhub:terminal-history";
const HISTORY_MAX = 200;

export function readTerminalHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  } catch {
    return [];
  }
}

/** Prepend a command, deduping the previous head. Returns the new list. */
export function recordTerminalCommand(history: string[], command: string): string[] {
  const cmd = command.replace(/\s+$/, "");
  if (!cmd) return history;
  const next = [cmd, ...history.filter((h) => h !== cmd)].slice(0, HISTORY_MAX);
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota */
  }
  return next;
}

/**
 * Subsequence fuzzy match with scoring: consecutive and word-start character
 * hits rank higher. Case-insensitive; returns matches best-first.
 */
export function fuzzyFilterHistory(history: string[], query: string, limit = 12): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return history.slice(0, limit);
  const scored: { item: string; score: number }[] = [];
  for (const item of history) {
    const hay = item.toLowerCase();
    let score = 0;
    let hi = 0;
    let prevMatch = -2;
    let ok = true;
    for (let qi = 0; qi < q.length; qi++) {
      const idx = hay.indexOf(q[qi]!, hi);
      if (idx === -1) {
        ok = false;
        break;
      }
      score += idx === prevMatch + 1 ? 3 : 1;
      if (idx === 0 || /\W/.test(hay[idx - 1] ?? "")) score += 2;
      prevMatch = idx;
      hi = idx + 1;
    }
    if (ok) scored.push({ item, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.item);
}
