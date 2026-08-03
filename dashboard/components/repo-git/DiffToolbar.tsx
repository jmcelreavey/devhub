"use client";

import type { ReactNode } from "react";
import { Maximize2 } from "lucide-react";

export type DiffContextMode = "default" | "more" | "full";

export const DIFF_CONTEXT_LINES: Record<DiffContextMode, number> = {
  default: 3,
  more: 20,
  full: 999_999,
};

/** Shared Hunk / More / Full + optional Open-with slot + maximize. */
export function DiffToolbar({
  mode,
  onModeChange,
  onMaximize,
  maximizeDisabled,
  openSlot,
  hideContext = false,
}: {
  mode: DiffContextMode;
  onModeChange: (mode: DiffContextMode) => void;
  onMaximize?: () => void;
  maximizeDisabled?: boolean;
  openSlot?: ReactNode;
  /** Stash whole-patch preview may omit context toggles until per-file exists. */
  hideContext?: boolean;
}) {
  return (
    <div className="repo-git-diff-actions">
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
