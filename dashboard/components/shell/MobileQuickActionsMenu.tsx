"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, ListTodo, MoreHorizontal, PenTool, TerminalSquare } from "lucide-react";

interface QuickAction {
  id: string;
  label: string;
  icon: ReactNode;
  /** Window event the matching panel/dock listens for. */
  event: string;
}

/**
 * On a phone the top bar can't hold Notes + Tasks + Diagrams + Terminal as
 * separate icons without crowding, so they collapse into one overflow menu.
 * Each item fires the same window event the desktop quick-action buttons do —
 * the panels/dock are the single source of truth for behaviour.
 */
const ACTIONS: QuickAction[] = [
  { id: "notes", label: "Notes", icon: <FolderOpen size={14} />, event: "devhub:notes-toggle" },
  { id: "tasks", label: "Tasks", icon: <ListTodo size={14} />, event: "devhub:tasks-toggle" },
  { id: "diagrams", label: "Diagrams", icon: <PenTool size={14} />, event: "devhub:diagrams-toggle" },
  { id: "terminal", label: "Terminal", icon: <TerminalSquare size={14} />, event: "devhub:terminal-toggle" },
];

export function MobileQuickActionsMenu() {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function updateMenuPosition() {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuStyle({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", updateMenuPosition);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", updateMenuPosition);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="launch-menu-wrap">
      <button
        type="button"
        className="hub-icon-btn"
        onClick={() => {
          updateMenuPosition();
          setOpen((value) => !value);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Quick actions"
      >
        <MoreHorizontal size={16} aria-hidden />
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div ref={menuRef} className="launch-menu" role="menu" style={menuStyle}>
            {ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                className="launch-menu-item"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  window.dispatchEvent(new CustomEvent(action.event));
                }}
              >
                <span className="launch-menu-icon">{action.icon}</span>
                <span className="launch-menu-copy">
                  <span className="launch-menu-label">{action.label}</span>
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
