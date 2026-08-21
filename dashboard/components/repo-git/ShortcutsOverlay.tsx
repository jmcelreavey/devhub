"use client";

import { ModalShell } from "@/components/shell/ModalShell";
import type { RepoGitTabId } from "./shared";

interface Shortcut {
  keys: string[];
  what: string;
  /** Only shown when this tab is active; omitted means "everywhere". */
  tab?: RepoGitTabId;
}

/**
 * One list, filtered by tab. Keeping every shortcut in a single table means a
 * new binding is one row here rather than a second place to forget.
 */
const SHORTCUTS: { group: string; items: Shortcut[] }[] = [
  {
    group: "Workspace",
    items: [
      { keys: ["?"], what: "Show this list" },
      { keys: ["Esc"], what: "Close the top-most dialog" },
      { keys: ["←", "→"], what: "Previous / next tab (while a tab is focused)" },
      { keys: ["Home", "End"], what: "First / last tab" },
    ],
  },
  {
    group: "Panes",
    items: [
      { keys: ["Tab"], what: "Move focus to the split handle" },
      { keys: ["←", "→"], what: "Resize the focused split" },
      { keys: ["⇧", "←/→"], what: "Resize in bigger steps" },
      { keys: ["Home", "End"], what: "Snap the split to min / max" },
    ],
  },
  {
    group: "History",
    items: [
      { keys: ["j", "↓"], what: "Next commit", tab: "history" },
      { keys: ["k", "↑"], what: "Previous commit", tab: "history" },
      { keys: ["/"], what: "Focus commit search", tab: "history" },
    ],
  },
  {
    group: "Diffs",
    items: [
      { keys: ["⌘", "F"], what: "Find in the diff under the pointer" },
      { keys: ["Enter"], what: "Next match" },
      { keys: ["⇧", "Enter"], what: "Previous match" },
      { keys: ["Esc"], what: "Close find" },
    ],
  },
];

export function ShortcutsOverlay({
  open,
  onClose,
  activeTab,
}: {
  open: boolean;
  onClose: () => void;
  activeTab: RepoGitTabId;
}) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      description="Git workspace"
      maxWidth="max-w-lg"
    >
      <div className="repo-git-shortcuts">
        {SHORTCUTS.map((section) => {
          const items = section.items.filter((s) => !s.tab || s.tab === activeTab);
          if (items.length === 0) return null;
          return (
            <div key={section.group} className="repo-git-shortcuts-group">
              <div className="repo-git-section-label">{section.group}</div>
              {items.map((s) => (
                <div key={`${section.group}:${s.what}`} className="repo-git-shortcuts-row">
                  <span className="repo-git-shortcuts-keys">
                    {s.keys.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </span>
                  <span>{s.what}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </ModalShell>
  );
}
