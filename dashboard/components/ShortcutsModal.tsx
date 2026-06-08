"use client";

import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";

const SHORTCUTS = [
  { keys: ["⌘", "K"], action: "Open command palette" },
  { keys: ["⌘", "⇧", "O"], action: "Open notes side panel" },
  { keys: ["⌘", "⇧", "T"], action: "Open tasks side panel" },
  { keys: ["⌘", "⇧", "D"], action: "Open diagrams side panel" },
  { keys: ["⌘", "⇧", "C"], action: "Quick capture (task, note, or learning)" },
  { keys: ["?"], action: "Show keyboard shortcuts" },
  { keys: ["Esc"], action: "Close panel / modal" },
  { keys: ["⌘", "\\"], action: "Toggle sidebar" },
  { keys: ["g", "h"], action: "Go to Today" },
  { keys: ["g", "n"], action: "Go to Notes" },
  { keys: ["g", "/"], action: "Go to Search" },
  { keys: ["g", "f"], action: "Go to Diagrams" },
  { keys: ["g", "s"], action: "Go to Status" },
  { keys: ["g", "o"], action: "Go to Ops" },
  { keys: ["g", "a"], action: "Go to Actions" },
  { keys: ["g", "r"], action: "Go to Repos" },
  { keys: ["g", "k"], action: "Go to Skills" },
  { keys: ["g", "l"], action: "Go to Calendar" },
  { keys: ["g", "j"], action: "Go to Tickets" },
  { keys: ["g", "t"], action: "Go to Tasks" },
  { keys: ["g", "p"], action: "Go to PRs" },
  { keys: ["g", "d"], action: "Go to Datadog" },
];

export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previousFocus.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-modal-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.5)",
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: "380px", maxWidth: "calc(100vw - 32px)", maxHeight: "80vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-header">
          <span id="shortcuts-modal-title">Keyboard Shortcuts</span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts dialog"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}
          >
            <X size={14} aria-hidden />
          </button>
        </div>
        <div className="card-body" style={{ padding: "8px 16px" }}>
          {SHORTCUTS.map((s) => (
            <div
              key={s.action}
              className="flex items-center justify-between py-2 text-sm"
              style={{ borderBottom: "1px solid var(--border-muted)" }}
            >
              <span style={{ color: "var(--text-muted)" }}>{s.action}</span>
              <span className="flex items-center gap-1">
                {s.keys.map((k, i) => (
                  <span key={i}>
                    {i > 0 && <span style={{ color: "var(--text-subtle)", fontSize: "10px" }}>+</span>}
                    <kbd
                      style={{
                        background: "var(--bg)",
                        border: "1px solid var(--border)",
                        borderRadius: "4px",
                        padding: "2px 6px",
                        fontSize: "11px",
                        fontFamily: "inherit",
                        color: "var(--text)",
                        minWidth: "22px",
                        textAlign: "center",
                        display: "inline-block",
                      }}
                    >
                      {k}
                    </kbd>
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function useShortcutsModal() {
  const [open, setOpen] = useState(false);
  return { open, show: () => setOpen(true), hide: () => setOpen(false) };
}
