"use client";

import { Lock, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

interface GitIndexLockDialogProps {
  message: string | null;
  onClose: () => void;
}

/**
 * A held .git/index.lock means a git process died mid-write. DevHub never
 * removes it (that's how two writers clobber an index) — this dialog tells
 * the user what to check and the exact file to remove once they're sure.
 */
export function GitIndexLockDialog({ message, onClose }: GitIndexLockDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!message) return;
    const dialog = dialogRef.current;
    const t = window.setTimeout(() => {
      if (dialog && !dialog.open) dialog.showModal();
    }, 0);
    return () => {
      window.clearTimeout(t);
      if (dialog?.open) dialog.close();
    };
  }, [message]);

  if (!message) return null;

  const lockPath = /[\w./~-]*\.git\/index\.lock/.exec(message)?.[0] ?? null;

  return (
    <dialog
      ref={dialogRef}
      className="repo-git-hook-backdrop"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="repo-git-hook-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="repo-git-hook-header">
          <div className="repo-git-hook-title-block">
            <p className="repo-git-hook-eyebrow">Git index locked</p>
            <h2 id={titleId} className="repo-git-hook-title">
              <Lock size={14} aria-hidden style={{ verticalAlign: "-2px", marginRight: 6 }} />
              A git operation died mid-write
            </h2>
            <p className="repo-git-hook-summary">{message}</p>
            {lockPath ? (
              <p className="repo-git-hook-logpath">
                Lock file: <span className="font-mono">{lockPath}</span>
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-ghost repo-git-close"
            aria-label="Dismiss"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </header>

        <pre className="repo-git-hook-log" tabIndex={0}>
{`DevHub will not remove this lock itself — deleting it while a git process is
running corrupts the index.

Safe recovery:
  1. Check nothing is running:  pgrep -af "git (status|add|commit|fetch|push|pull|stash|rebase)"
  2. Check for a crashed helper: ps aux | grep -E "git-(lfs|pack-objects|index-pack)"
  3. If no git process exists for this repo, remove the lock:
       rm ${lockPath ?? "<repo>/.git/index.lock"}

If a git process IS running, wait for it — the lock clears itself.`}
        </pre>

        <footer className="repo-git-hook-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Got it
          </button>
        </footer>
      </div>
    </dialog>
  );
}
