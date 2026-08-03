"use client";

import { useEffect, type ReactNode } from "react";
import { ModalShell } from "@/components/shell/ModalShell";
import { DiffToolbar, type DiffContextMode } from "./DiffToolbar";

/**
 * Full-screen diff view shared by Changes / History / Stash.
 *
 * All three grew their own copy of this modal, and all three had the same latent
 * bug: `open` was `maximized && Boolean(selection)`, so losing the selection hid
 * the modal without clearing `maximized` — and the next file you clicked popped
 * it straight back open. `canOpen` + the effect below make that impossible.
 */
export function DiffMaximizeModal({
  maximized,
  canOpen,
  onClose,
  title,
  description,
  mode,
  onModeChange,
  openSlot,
  children,
}: {
  maximized: boolean;
  /** Whether there is still something to show — losing it dismisses, not defers. */
  canOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  mode: DiffContextMode;
  onModeChange: (mode: DiffContextMode) => void;
  openSlot?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (maximized && !canOpen) onClose();
  }, [maximized, canOpen, onClose]);

  return (
    <ModalShell
      open={maximized && canOpen}
      onClose={onClose}
      title={title}
      description={description}
      maxWidth="max-w-[min(96vw,1200px)]"
      align="top"
    >
      <div className="repo-git-diff-modal">
        <div className="repo-git-diff-head">
          <span className="font-mono truncate" title={title}>
            {title}
          </span>
          <DiffToolbar mode={mode} onModeChange={onModeChange} openSlot={openSlot} />
        </div>
        <div className="repo-git-diff-modal-body">{children}</div>
      </div>
    </ModalShell>
  );
}
