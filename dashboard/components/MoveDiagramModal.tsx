"use client";

import { useEffect } from "react";
import { Folder, FolderInput, Home } from "lucide-react";

export interface MoveDiagramTarget {
  /** Folder rel-path relative to the diagrams root ("" = top level). */
  relPath: string;
  label: string;
  /** Disabled targets (current location, or a folder's own subtree). */
  disabled?: boolean;
}

/** Folder picker for moving a diagram or folder. Reused for both. */
export function MoveDiagramModal({
  itemName,
  targets,
  onMove,
  onClose,
}: {
  itemName: string;
  targets: MoveDiagramTarget[];
  onMove: (relPath: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Move ${itemName}`}
      className="modal-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 300,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card modal-panel"
        style={{ width: "100%", maxWidth: 420, padding: 20, background: "var(--bg-surface)" }}
      >
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
          Move &ldquo;{itemName}&rdquo;
        </h2>
        <p style={{ margin: "8px 0 12px", color: "var(--text-muted)", fontSize: 13 }}>
          Choose a destination folder.
        </p>
        <div
          className="flex flex-col gap-0.5 overflow-y-auto"
          style={{ maxHeight: "min(50vh, 320px)" }}
        >
          {targets.map((t) => (
            <button
              key={t.relPath || "__root__"}
              type="button"
              disabled={t.disabled}
              onClick={() => onMove(t.relPath)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--bg-elevated)] disabled:opacity-40 disabled:pointer-events-none"
              style={{ color: "var(--text)" }}
            >
              {t.relPath === "" ? (
                <Home size={14} style={{ color: "var(--text-subtle)" }} aria-hidden />
              ) : (
                <Folder size={14} style={{ color: "var(--text-subtle)" }} aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate">{t.label}</span>
              {t.disabled ? (
                <span className="shrink-0 text-xs" style={{ color: "var(--text-subtle)" }}>
                  current
                </span>
              ) : (
                <FolderInput
                  size={12}
                  className="shrink-0"
                  style={{ color: "var(--text-subtle)" }}
                  aria-hidden
                />
              )}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
