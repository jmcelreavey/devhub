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

export function appendSessionHistory(
  history: readonly SessionHistoryEntry[],
  entry: SessionHistoryEntry,
  limit = LIMIT,
): SessionHistoryEntry[] {
  const href = hrefKey(entry.href);
  const last = history.at(-1);
  const back = history.at(-2);
  if (back && hrefKey(back.href) === href) return history.slice(0, -1);
  if (last && hrefKey(last.href) === href) {
    return [...history.slice(0, -1), { ...last, ts: entry.ts }];
  }
  return [...history, { ...entry, href }].slice(-limit);
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
