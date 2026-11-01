export interface SessionHistoryEntry {
  label: string;
  href: string;
  ts: number;
}

const LIMIT = 10;
const EMPTY: SessionHistoryEntry[] = [];
let entries: SessionHistoryEntry[] = [];
const labels = new Map<string, string>();
const listeners = new Set<() => void>();

/**
 * Keep in sync with `normalizeHref` in workspace-tabs.ts. Duplicated here so
 * this module does not import workspace-tabs (that file imports us).
 */
function hrefKey(href: string): string {
  if (!href) return "/";
  const qIndex = href.indexOf("?");
  const path = qIndex === -1 ? href : href.slice(0, qIndex);
  const query = qIndex === -1 ? "" : href.slice(qIndex + 1);
  const trimmed = path !== "/" ? path.replace(/\/+$/, "") : "/";
  return query ? `${trimmed}?${query}` : trimmed;
}

/**
 * Crumb identity ignores query strings so `/agents?view=activity` and
 * `/agents` collapse to one Agents entry (views share the same nav label).
 */
export function crumbKey(href: string): string {
  const key = hrefKey(href);
  const q = key.indexOf("?");
  return q === -1 ? key : key.slice(0, q);
}

/**
 * Session trail for hub breadcrumbs / palette. Unique by crumb path —
 * revisiting Agents (any ?view=) moves that crumb to the end instead of
 * stacking Agents › Agents › Agents.
 */
export function appendSessionHistory(
  history: readonly SessionHistoryEntry[],
  entry: SessionHistoryEntry,
  limit = LIMIT,
): SessionHistoryEntry[] {
  const href = hrefKey(entry.href);
  const key = crumbKey(href);
  const without = history.filter((item) => crumbKey(item.href) !== key);
  return [...without, { ...entry, href }].slice(-limit);
}

/** Unique crumb paths in visit order (last occurrence wins) — for HubTopBar. */
export function uniqueSessionHistory(
  history: readonly SessionHistoryEntry[],
  limit = 5,
): SessionHistoryEntry[] {
  const seen = new Set<string>();
  const out: SessionHistoryEntry[] = [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i]!;
    const key = crumbKey(item.href);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out.reverse();
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function recordSessionVisit(entry: SessionHistoryEntry): void {
  entries = appendSessionHistory(entries, { ...entry, label: labels.get(entry.href) ?? entry.label });
  emit();
}

export function publishSessionLabel(href: string, label: string): void {
  labels.set(href, label);
  const index = entries.findLastIndex((entry) => entry.href === href);
  if (index < 0 || entries[index].label === label) return;
  entries = entries.map((entry, i) => (i === index ? { ...entry, label } : entry));
  emit();
}

export function subscribeSessionHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSessionHistory(): SessionHistoryEntry[] {
  return entries;
}

export function getServerSessionHistory(): SessionHistoryEntry[] {
  return EMPTY;
}
