"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface ContextMenuItem {
  id: string;
  label: string;
  /** Second line — say what the action will actually do to the repo. */
  description?: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** Shown greyed next to the label when the item is disabled. */
  disabledReason?: string;
  onSelect: () => void | Promise<void>;
}

/** A labelled run of items. An empty label renders as a plain divider. */
export interface ContextMenuGroup {
  id: string;
  label?: string;
  items: ContextMenuItem[];
}

export interface ContextMenuPosition {
  x: number;
  y: number;
}

/**
 * Right-click menu, anchored at the pointer.
 *
 * Uses the Popover API for the same reason {@link LaunchMenu} does: these menus
 * are opened from inside the Git workspace's modal `<dialog>`, which lives in
 * the browser top layer. A `position: fixed` menu — at any z-index — paints
 * underneath it.
 */
export function ContextMenu({
  open,
  position,
  groups,
  onClose,
  label = "Context menu",
}: {
  open: boolean;
  position: ContextMenuPosition | null;
  groups: ContextMenuGroup[];
  onClose: () => void;
  label?: string;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const itemNodes = useCallback(
    () =>
      Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>(".context-menu-item:not([disabled])") ??
          [],
      ),
    [],
  );

  const focusItemAt = useCallback(
    (index: number) => {
      const nodes = itemNodes();
      if (nodes.length === 0) return;
      const wrapped = ((index % nodes.length) + nodes.length) % nodes.length;
      nodes[wrapped]?.focus();
    },
    [itemNodes],
  );

  /**
   * Flip the menu back inside the viewport before paint. Measuring in a layout
   * effect avoids the frame where a menu opened near the bottom edge renders
   * off-screen and then jumps.
   */
  useLayoutEffect(() => {
    if (!open || !position) return;
    const el = menuRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(
      margin,
      Math.min(position.x, window.innerWidth - width - margin),
    );
    const top = Math.max(
      margin,
      Math.min(position.y, window.innerHeight - height - margin),
    );
    setStyle({ top, left });
  }, [open, position]);

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const supportsPopover = typeof el.showPopover === "function";

    if (open) {
      if (supportsPopover) {
        try {
          if (!el.matches(":popover-open")) el.showPopover();
        } catch {
          // Fall back to the [hidden] + fixed-position styling.
        }
      }
    } else if (supportsPopover) {
      try {
        if (el.matches(":popover-open")) el.hidePopover();
      } catch {
        // already closed
      }
      return;
    }

    if (!open) return;

    const onDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    // Capture phase + stopPropagation: without it Escape also reaches the
    // enclosing <dialog> and closes the whole Git workspace behind the menu.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      onClose();
    };
    const onScroll = () => onClose();

    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("contextmenu", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("contextmenu", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, onClose]);

  const visibleGroups = groups.filter((g) => g.items.length > 0);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label={label}
      style={{ top: style.top, left: style.left }}
      hidden={!open ? true : undefined}
      onKeyDown={(event) => {
        const nodes = itemNodes();
        const current = nodes.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === "ArrowDown") {
          event.preventDefault();
          focusItemAt(current + 1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          focusItemAt(current - 1);
        } else if (event.key === "Home") {
          event.preventDefault();
          focusItemAt(0);
        } else if (event.key === "End") {
          event.preventDefault();
          focusItemAt(nodes.length - 1);
        } else if (event.key === "Tab") {
          onClose();
        }
      }}
      {...({ popover: "manual" } as { popover?: "manual" })}
    >
      {visibleGroups.map((group, index) => (
        <div key={group.id} className="context-menu-group">
          {index > 0 && <div className="context-menu-divider" role="separator" />}
          {group.label && <div className="context-menu-group-label">{group.label}</div>}
          {group.items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="context-menu-item"
              data-danger={item.danger ? "true" : undefined}
              disabled={item.disabled}
              title={item.disabled ? item.disabledReason : item.description}
              onClick={() => {
                onClose();
                void item.onSelect();
              }}
            >
              {item.icon && <span className="context-menu-icon">{item.icon}</span>}
              <span className="context-menu-copy">
                <span className="context-menu-label">{item.label}</span>
                {(item.disabled && item.disabledReason ? item.disabledReason : item.description) && (
                  <span className="context-menu-description">
                    {item.disabled && item.disabledReason ? item.disabledReason : item.description}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * State plumbing for one context menu shared by a list of rows: which row was
 * right-clicked, and where the pointer was.
 */
export function useContextMenu<T>() {
  const [state, setState] = useState<{ target: T; position: ContextMenuPosition } | null>(null);

  const openAt = useCallback((event: React.MouseEvent, target: T) => {
    event.preventDefault();
    event.stopPropagation();
    setState({ target, position: { x: event.clientX, y: event.clientY } });
  }, []);

  const close = useCallback(() => setState(null), []);

  return { target: state?.target ?? null, position: state?.position ?? null, openAt, close };
}
