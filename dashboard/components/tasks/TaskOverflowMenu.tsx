"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { HoverTip } from "@/components/ui/HoverTip";

export interface TaskOverflowAction {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  /** Destructive / caution styling for delete-ish items. */
  danger?: boolean;
}

/**
 * Compact ⋯ menu for secondary task-row actions so the hover shelf stays
 * icon-first (timer / note / Jira) instead of a text pile.
 */
export function TaskOverflowMenu({ actions }: { actions: TaskOverflowAction[] }) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function updateMenuPosition() {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuStyle({
      top: rect.bottom + 4,
      right: Math.max(8, window.innerWidth - rect.right),
    });
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

  if (actions.length === 0) return null;

  return (
    <div ref={rootRef} className="relative">
      <HoverTip label="More actions" pos="top-end" className="task-action-tip">
        <button
          type="button"
          className="task-icon-action"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="More task actions"
          onClick={(e) => {
            e.stopPropagation();
            updateMenuPosition();
            setOpen((value) => !value);
          }}
        >
          <MoreHorizontal size={12} aria-hidden />
        </button>
      </HoverTip>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Task actions"
            className="today-actions-menu pop-soft"
            data-portal
            style={menuStyle}
          >
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                className="launch-menu-item"
                data-danger={action.danger ? "true" : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  action.onSelect();
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
