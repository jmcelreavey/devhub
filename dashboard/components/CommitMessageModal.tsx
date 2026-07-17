"use client";

import { useEffect, useRef, useState } from "react";
import { X, FileText, StickyNote, ListChecks, PenTool, GitMerge, type LucideIcon } from "lucide-react";

export function defaultCommitCheckpointMessage(): string {
  return `chore: devhub checkpoint ${new Date().toISOString().slice(0, 10)}`;
}

export interface FileStat {
  notes: number;
  tasks: number;
  diagrams: number;
  other: number;
}

const FILE_STAT_ITEMS: { key: keyof FileStat; Icon: LucideIcon }[] = [
  { key: "notes", Icon: StickyNote },
  { key: "tasks", Icon: ListChecks },
  { key: "diagrams", Icon: PenTool },
  { key: "other", Icon: FileText },
];

interface CommitMessageModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (message: string) => void;
  title: string;
  description?: string;
  defaultMessage: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: "default" | "warning";
  fileStats?: FileStat;
}

/**
 * In-app commit message entry — matches ConfirmDialog overlay / card styling.
 */
export function CommitMessageModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  defaultMessage,
  confirmLabel,
  cancelLabel = "Cancel",
  variant = "default",
  fileStats,
}: CommitMessageModalProps) {
  const titleId = "commit-message-modal-title";
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [editedMessage, setEditedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setEditedMessage(null);
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKeyDown);
      previousFocus.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const message = editedMessage ?? defaultMessage;
  const resolved = message.trim() || defaultMessage;

  function handleClose() {
    setEditedMessage(null);
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="modal-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--scrim)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 300,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="card modal-panel"
        style={{
          width: "100%",
          maxWidth: 440,
          padding: 20,
          background: "var(--bg-surface)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id={titleId} style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
            {title}
          </h2>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: "4px 6px", color: "var(--text-subtle)", flexShrink: 0 }}
            onClick={handleClose}
            aria-label="Close"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
        {description && (
          <p style={{ margin: "8px 0 0", color: "var(--text-muted)", fontSize: 13, lineHeight: 1.45 }}>
            {description}
          </p>
        )}
        {fileStats && (
          <div className="file-stats-bar">
            <span className="file-stats-total">
              <GitMerge size={12} aria-hidden />
              {fileStats.notes + fileStats.tasks + fileStats.diagrams + fileStats.other} changed
            </span>
            {FILE_STAT_ITEMS.map(({ key, Icon }) =>
              fileStats[key] > 0 ? (
                <span key={key} className="file-stats-item">
                  <Icon size={11} aria-hidden />
                  {fileStats[key]}
                </span>
              ) : null,
            )}
          </div>
        )}
        <label className="block mt-3 text-xs font-medium" style={{ color: "var(--text-subtle)" }}>
          Commit message
        </label>
        <textarea
          ref={inputRef}
          className="input w-full mt-1 font-mono"
          style={{ fontSize: 12, minHeight: 72, resize: "vertical" }}
          rows={3}
          value={message}
          onChange={(e) => setEditedMessage(e.target.value)}
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              setEditedMessage(null);
              onConfirm(resolved);
            }
          }}
        />
        <p className="mt-1 text-xs" style={{ color: "var(--text-subtle)" }}>
          ⌘/Ctrl+Enter to confirm
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="btn btn-ghost" onClick={handleClose}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn btn-primary text-xs"
            style={
              variant === "warning"
                ? {
                    background: "var(--warning)",
                    borderColor: "var(--warning)",
                    color: "var(--bg)",
                  }
                : undefined
            }
            onClick={() => {
              setEditedMessage(null);
              onConfirm(resolved);
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
