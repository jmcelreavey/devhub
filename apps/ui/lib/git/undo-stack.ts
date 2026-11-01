/**
 * Per-repo undo stack for actions DevHub itself performed.
 *
 * Every recorded entry carries the HEAD sha from immediately before the
 * action, so undo is always one of two primitives: `reset --soft HEAD~1`
 * (plain commit) or `reset --hard <headBefore>` behind a backup branch
 * (cherry-pick / revert / merge / pull-merge). No reflog archaeology — if
 * DevHub didn't perform it, it isn't undoable here.
 *
 * sessionStorage, capped at 5, best-effort: private mode or an evicted tab
 * just means the chip doesn't show.
 */

export interface UndoEntry {
  /** Stable id so re-recording the same action twice is visible in tests. */
  id: string;
  /** Chip copy, e.g. `cherry-pick a1b2c3d`. */
  label: string;
  /** HEAD immediately before the action — the reset target. */
  headBefore: string;
  kind: "soft" | "hard";
  at: number;
}

const CAP = 5;

function key(repoName: string): string {
  return `devhub.gitundo.${repoName}`;
}

function read(repoName: string): UndoEntry[] {
  try {
    const raw = window.sessionStorage.getItem(key(repoName));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as UndoEntry[]) : [];
  } catch {
    return [];
  }
}

function write(repoName: string, entries: UndoEntry[]): void {
  try {
    window.sessionStorage.setItem(key(repoName), JSON.stringify(entries.slice(0, CAP)));
  } catch {
    // Storage unavailable — undo is a convenience, never a requirement.
  }
}

export function recordUndo(repoName: string, entry: Omit<UndoEntry, "at">): void {
  const entries = read(repoName).filter((e) => e.id !== entry.id);
  write(repoName, [{ ...entry, at: Date.now() }, ...entries]);
}

export function peekUndo(repoName: string): UndoEntry | null {
  return read(repoName)[0] ?? null;
}

export function popUndo(repoName: string): UndoEntry | null {
  const entries = read(repoName);
  const [first] = entries;
  if (first) write(repoName, entries.slice(1));
  return first ?? null;
}

export function clearUndo(repoName: string): void {
  try {
    window.sessionStorage.removeItem(key(repoName));
  } catch {
    // ignore
  }
}
