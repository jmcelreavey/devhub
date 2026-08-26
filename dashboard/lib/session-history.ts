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

export function appendSessionHistory(
  history: readonly SessionHistoryEntry[],
  entry: SessionHistoryEntry,
  limit = LIMIT,
): SessionHistoryEntry[] {
  const next = history.at(-1)?.href === entry.href ? [...history.slice(0, -1), entry] : [...history, entry];
  return next.slice(-limit);
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
