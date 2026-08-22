"use client";

import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";

interface ShortcutEntry {
  keys: string[];
  action: string;
}

const SHORTCUT_SECTIONS: { title: string; items: ShortcutEntry[] }[] = [
  {
    title: "General",
    items: [
      { keys: ["⌘", "K"], action: "Open command palette" },
      { keys: ["⌘", "⇧", "O"], action: "Open notes side panel" },
      { keys: ["⌘", "⇧", "T"], action: "Open tasks side panel" },
      { keys: ["⌘", "⇧", "D"], action: "Open diagrams side panel" },
      { keys: ["⌘", "⇧", "C"], action: "Quick capture (task, note, or learning)" },
      { keys: ["?"], action: "Show keyboard shortcuts" },
      { keys: ["Esc"], action: "Close panel / modal" },
      { keys: ["⌘", "\\"], action: "Toggle sidebar" },
    ],
  },
  {
    title: "Go to",
    items: [
      { keys: ["g", "h"], action: "Today" },
      { keys: ["g", "n"], action: "Notes" },
      { keys: ["g", "/"], action: "Search" },
      { keys: ["g", "f"], action: "Diagrams" },
      { keys: ["g", "s"], action: "Status" },
      { keys: ["g", "o"], action: "Ops" },
      { keys: ["g", "a"], action: "Actions" },
      { keys: ["g", "r"], action: "Repos" },
      { keys: ["g", "k"], action: "Skills" },
      { keys: ["g", "l"], action: "Calendar" },
      { keys: ["g", "j"], action: "Tickets" },
      { keys: ["g", "t"], action: "Tasks" },
      { keys: ["g", "p"], action: "PRs" },
      { keys: ["g", "d"], action: "Datadog" },
    ],
  },
  {
    title: "Terminal",
    items: [
      { keys: ["⌃", "`"], action: "Toggle terminal dock" },
      { keys: ["⌥", "T"], action: "New terminal tab" },
      { keys: ["⌥", "⇧", "W"], action: "Close terminal tab" },
      { keys: ["⌥", "1-9"], action: "Switch terminal tab" },
      { keys: ["⌘", "+/−/0"], action: "Terminal font size" },
      { keys: ["⌘", "F"], action: "Find in terminal output" },
      { keys: ["⌃", "R"], action: "Fuzzy command history (prompt bar)" },
      { keys: ["Right-click"], action: "Send output to Agent" },
    ],
  },
  {
    title: "Git workspace",
    items: [
      { keys: ["?"], action: "Git shortcuts (inside Open Git)" },
      { keys: ["j", "k"], action: "Next / previous commit" },
      { keys: ["/"], action: "Focus commit search" },
    ],
  },
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
      className="modal-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: "var(--z-overlay)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--scrim)",
      }}
      onClick={onClose}
    >
      <div
        className="card modal-panel"
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
          {SHORTCUT_SECTIONS.map((section) => (
            <div key={section.title} role="group" aria-label={section.title}>
              <div
                className="text-[11px] font-semibold uppercase tracking-wide pt-3 pb-1 first:pt-1"
                style={{ color: "var(--text-subtle)" }}
              >
                {section.title}
              </div>
              {section.items.map((s) => (
                <div
                  key={`${section.title}:${s.action}`}
                  className="flex items-center justify-between py-2 text-sm"
                  style={{ borderBottom: "1px solid var(--border-muted)" }}
                >
                  <span className="text-text-muted">{s.action}</span>
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
