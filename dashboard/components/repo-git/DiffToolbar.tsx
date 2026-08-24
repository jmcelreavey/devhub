"use client";

import type { ReactNode } from "react";
import { Maximize2 } from "lucide-react";
import { useStoredChoice } from "@/lib/hooks/use-stored-state";
import type { DiffViewMode } from "./GitDiffView";

export type { DiffViewMode };

export function useDiffViewMode(): [DiffViewMode, (view: DiffViewMode) => void] {
  return useStoredChoice<DiffViewMode>("devhub.diff.view", "unified", ["unified", "split"]);
}

export type DiffContextMode = "default" | "more" | "full";

export const DIFF_CONTEXT_LINES: Record<DiffContextMode, number> = {
  default: 3,
  more: 20,
  full: 999_999,
};

/** Shared Hunk / More / Full + optional layout toggle + Open-with slot + maximize. */
export function DiffToolbar({
  mode,
  onModeChange,
  onMaximize,
  maximizeDisabled,
  openSlot,
  hideContext = false,
  view,
  onViewChange,
}: {
  mode: DiffContextMode;
  onModeChange: (mode: DiffContextMode) => void;
  onMaximize?: () => void;
  maximizeDisabled?: boolean;
  openSlot?: ReactNode;
  /** Stash whole-patch preview may omit context toggles until per-file exists. */
  hideContext?: boolean;
  /** When both set, show the Unified/Side-by-side layout toggle. */
  view?: DiffViewMode;
  onViewChange?: (view: DiffViewMode) => void;
}) {
  return (
    <div className="repo-git-diff-actions">
      {view && onViewChange ? (
        <div className="repo-git-diff-context" role="group" aria-label="Diff layout">
          {(
            [
              ["unified", "Unified", "Single column with change markers"],
              ["split", "Split", "Side-by-side old and new"],
            ] as const
          ).map(([id, label, title]) => (
            <button
              key={id}
              type="button"
              className="repo-git-diff-context-btn"
              data-active={view === id || undefined}
              aria-pressed={view === id}
              title={title}
              onClick={() => onViewChange(id)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {!hideContext ? (
        <div className="repo-git-diff-context" role="group" aria-label="Diff context">
          {(
            [
              ["default", "Hunk"],
              ["more", "More"],
              ["full", "Full"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="repo-git-diff-context-btn"
              data-active={mode === id || undefined}
              aria-pressed={mode === id}
              title={
                id === "default"
                  ? "Default hunk context (3 lines)"
                  : id === "more"
                    ? "More context around changes (20 lines)"
                    : "Show the whole file with changes highlighted"
              }
              onClick={() => onModeChange(id)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {openSlot}
      {onMaximize ? (
        <button
          type="button"
          className="btn btn-ghost repo-git-diff-maximize"
          disabled={maximizeDisabled}
          title="Open diff in a larger view"
          aria-label="Maximize diff"
          onClick={onMaximize}
        >
          <Maximize2 size={12} />
        </button>
      ) : null}
    </div>
  );
}
