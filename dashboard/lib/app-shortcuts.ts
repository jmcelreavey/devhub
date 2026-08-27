/**
 * Global app chords (command palette, side panels). Keep this table in one
 * place so help copy, the keydown listener, and tests cannot drift.
 *
 * Terminal toggle is Ctrl+` in TerminalDock — not listed here because that
 * listener lives next to the dock (and ⌘T is Tasks).
 *
 * Repo drill-in chords (⌘Enter upstart, ⌘⇧T terminal) are `repoShortcutFromEvent`.
 * ⌘⇧T is also the tasks-panel shift alias; the visible `/repos/:name` page wins.
 * Chrome's "reopen closed tab" may still swallow ⌘⇧T in a browser tab;
 * DevHub.app owns the chord.
 */
export type AppShortcut = "palette" | "notes" | "tasks" | "diagrams" | "capture";

export type RepoShortcut = "upstart" | "terminal";

export type WorkspaceTabChord =
  | { type: "jump"; index: number }
  | { type: "cycle"; dir: 1 | -1 };

/**
 * Workspace tab chords. ⌘1–⌘9 jump; Ctrl+Tab / Ctrl+Shift+Tab cycle.
 * Does not use ⌘P/N/D/T or Ctrl+` (those are already spoken for).
 * Ctrl+Tab is a no-op in Chrome (the browser eats it); it works in DevHub.app.
 */
export function workspaceTabChordFromEvent(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
): WorkspaceTabChord | null {
  if (e.altKey) return null;
  if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key) && !e.shiftKey) {
    return { type: "jump", index: Number(e.key) };
  }
  if (e.ctrlKey && !e.metaKey && e.key === "Tab") {
    return { type: "cycle", dir: e.shiftKey ? -1 : 1 };
  }
  return null;
}

export function appShortcutFromEvent(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">): AppShortcut | null {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (key === "p" && !e.shiftKey) return "palette";
  if (key === "n" && !e.shiftKey) return "notes";
  if (key === "d" && !e.shiftKey) return "diagrams";
  if (key === "t" && !e.shiftKey) return "tasks";
  // Previous shift-chords stay as aliases so muscle memory doesn't break.
  if (key === "o" && e.shiftKey) return "notes";
  if (key === "d" && e.shiftKey) return "diagrams";
  if (key === "t" && e.shiftKey) return "tasks";
  if (key === "c" && e.shiftKey) return "capture";
  return null;
}

/**
 * `/repos/:name` only — not the repos list. Decodes the segment the same way
 * workspace tabs title a repo tab.
 */
export function repoDrillInNameFromPath(pathname: string): string | null {
  const path = (pathname.split("?")[0] ?? pathname).replace(/\/+$/, "") || "/";
  const match = path.match(/^\/repos\/([^/]+)$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * Repo-page chords. ⌘Enter (Ctrl+Enter) → upstart; ⌘⇧T (Ctrl+Shift+T) →
 * terminal in that repo. ⌘T without shift stays Tasks.
 */
export function repoShortcutFromEvent(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
): RepoShortcut | null {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod || e.altKey) return null;
  if (e.key === "Enter" && !e.shiftKey) return "upstart";
  if (e.key.toLowerCase() === "t" && e.shiftKey) return "terminal";
  return null;
}

/** Visible repo drill-in claims ⌘Enter / ⌘⇧T so the tasks alias does not also fire. */
export function repoPageOwnsShortcut(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  pathname: string,
): boolean {
  return repoDrillInNameFromPath(pathname) != null && repoShortcutFromEvent(e) != null;
}
