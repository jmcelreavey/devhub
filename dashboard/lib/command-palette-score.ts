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

export type PaletteScope = "all" | "repo" | "note" | "task" | "action" | "content";

export interface PaletteListItem {
  id: string;
  kind: string;
  label: string;
  detail?: string;
  hint?: string;
}

/** First occurrence of each id wins. Palette rows key on id — duplicates stack in the DOM. */
export function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/**
 * Visible palette rows for a query. Empty query is the default landing list;
 * a non-empty query scores the catalog plus content hits. Always unique by id
 * so a second search cycle cannot append another shortcuts copy.
 */
export function filterVisiblePaletteCommands<T extends PaletteListItem>(
  commands: readonly T[],
  query: string,
  extras: { contentResults?: readonly T[]; recent?: readonly T[]; scope?: PaletteScope } = {},
): T[] {
  const scope = extras.scope ?? "all";
  const matchesScope = (command: T) => {
    if (scope === "all") return true;
    if (scope === "note") {
      return command.kind === "note" || command.kind === "diagram" || command.id.startsWith("content:notes:");
    }
    if (scope === "task") return command.kind === "task" || command.kind === "ticket";
    return command.kind === scope;
  };
  const unique = uniqueById(commands).filter(matchesScope);
  if (!query.trim()) {
    if (scope !== "all") return scope === "content" ? [] : unique.slice(0, 20);

    const recent = uniqueById(extras.recent ?? []).slice(0, 5);
    const commonActionIds = new Set(["action:capture", "action:today-note", "action:ask-agent", "action:shortcuts"]);
    const action = unique.filter((c) => c.kind === "action" && commonActionIds.has(c.id)).slice(0, 4);
    const repo = unique
      .filter((c) => c.kind === "repo" && Boolean(c.detail?.includes("changed") || c.detail?.includes("unpushed")))
      .slice(0, 3);
    return uniqueById([...recent, ...repo, ...action]);
  }

  const scored = unique
    .map((c) => {
      const parts = [c.label, c.detail, c.hint].filter(
        (x): x is string => typeof x === "string" && x.trim().length > 0,
      );
      return { cmd: c, score: paletteCommandScore(query, parts) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 40)
    .map((x) => x.cmd);

  const matchedPaths = new Set(
    scored.filter((c) => c.kind === "note" || c.kind === "diagram").map((c) => c.detail ?? ""),
  );
  const dedupedContent = uniqueById(extras.contentResults ?? [])
    .filter(matchesScope)
    .filter((c) => !matchedPaths.has(c.label));
  return uniqueById([...scored, ...dedupedContent]).slice(0, 40);
}
