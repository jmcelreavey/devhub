"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { MoreHorizontal } from "lucide-react";

export const ROW_LONG_PRESS_MS = 500;
export const ROW_LONG_PRESS_MOVE_PX = 8;

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

export const CONTEXT_MENU_VIEWPORT_MARGIN = 8;
/** Matches `.context-menu { min-width }` — used when a closed popover measures 0×0. */
export const CONTEXT_MENU_MIN_WIDTH = 236;

export interface ViewportSize {
  width: number;
  height: number;
}

export interface MenuSize {
  width: number;
  height: number;
}

export interface ClampedMenuPosition {
  top: number;
  left: number;
  /** Set when the menu is taller than the viewport; pair with overflow-y: auto. */
  maxHeight?: number;
}

/** Visible window — prefer the visual viewport when a desktop webview lies about innerHeight. */
export function readViewportSize(): ViewportSize {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  const innerW = window.innerWidth;
  const innerH = window.innerHeight;
  return {
    width: Math.min(innerW, vv && vv.width > 0 ? vv.width : innerW),
    height: Math.min(innerH, vv && vv.height > 0 ? vv.height : innerH),
  };
}

/**
 * Keep the menu inside the viewport.
 *
 * Closed popovers measure 0×0. Treating that as a real size skips the overflow
 * flip; the first paint also used `{ top: 0, left: 0 }` while UA `[popover]`
 * still has `right: 0` — which is the top-right flash users reported.
 *
 * A menu taller than `viewport - 2*margin` cannot flip into view. Cap its
 * height and let `.context-menu` scroll so every item stays reachable.
 */
export function clampMenuPosition(
  x: number,
  y: number,
  size: MenuSize,
  viewport: ViewportSize,
  margin = CONTEXT_MENU_VIEWPORT_MARGIN,
): ClampedMenuPosition {
  const width = size.width > 0 ? size.width : CONTEXT_MENU_MIN_WIDTH;
  const measuredHeight = size.height > 0 ? size.height : 0;
  const availableHeight = Math.max(0, viewport.height - 2 * margin);
  const needsScroll = measuredHeight > availableHeight;
  const height = needsScroll ? availableHeight : measuredHeight;
  const maxLeft = viewport.width - width - margin;
  const left = Math.max(margin, Math.min(x, Math.max(margin, maxLeft)));
  const top =
    height > 0
      ? Math.max(margin, Math.min(y, Math.max(margin, viewport.height - height - margin)))
      : Math.max(margin, y);
  return needsScroll ? { top, left, maxHeight: availableHeight } : { top, left };
}

export interface RowMenuBind {
  onContextMenu: (event: ReactMouseEvent) => void;
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: (event: ReactPointerEvent) => void;
  onPointerCancel: (event: ReactPointerEvent) => void;
  onClick: (event: ReactMouseEvent) => void;
  onKeyDown: (event: ReactKeyboardEvent) => void;
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
  const [flipped, setFlipped] = useState<
    ({ key: string } & ClampedMenuPosition) | null
  >(null);
  const originKey = position ? `${position.x},${position.y}` : "";
  const placed = flipped?.key === originKey ? flipped : null;

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
      const node = nodes[wrapped];
      if (!node) return;
      // Keep the window still (capture-phase scroll closes the menu) and
      // scroll the item inside the menu's overflow port instead.
      node.focus({ preventScroll: true });
      node.scrollIntoView({ block: "nearest" });
    },
    [itemNodes],
  );

  /**
   * Show the popover (so it isn't `display: none`) then flip inside the
   * viewport — all before paint. `showPopover` lives here, not in the
   * post-paint effect: a closed popover measures 0×0, and the UA `[popover]`
   * `inset: 0; margin: auto` would otherwise win for a frame (top-right).
   */
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    // Nothing to measure while closed, and nothing to clear either: `placed`
    // above only trusts a `flipped` whose key matches the current originKey,
    // which is "" whenever position is null. Deriving beats a setState here.
    if (!open || !position) return;

    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.margin = "0";
    el.style.maxHeight = "";
    el.style.overflowY = "";
    el.style.top = `${position.y}px`;
    el.style.left = `${position.x}px`;

    if (typeof el.showPopover === "function") {
      try {
        if (!el.matches(":popover-open")) el.showPopover();
      } catch {
        // Fall back to the [hidden] + fixed-position styling.
      }
    }

    const { width, height } = el.getBoundingClientRect();
    const next = clampMenuPosition(
      position.x,
      position.y,
      { width, height },
      readViewportSize(),
    );
    el.style.top = `${next.top}px`;
    el.style.left = `${next.left}px`;
    if (next.maxHeight != null) {
      el.style.maxHeight = `${next.maxHeight}px`;
      el.style.overflowY = "auto";
    }
    setFlipped({ key: originKey, ...next });
  }, [open, position, originKey]);

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const supportsPopover = typeof el.showPopover === "function";

    if (!open) {
      if (supportsPopover) {
        try {
          if (el.matches(":popover-open")) el.hidePopover();
        } catch {
          // already closed
        }
      }
      return;
    }

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
    const onScroll = (event: Event) => {
      // Wheel / arrow-focus inside a tall menu must not dismiss it.
      if (el.contains(event.target as Node)) return;
      onClose();
    };

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
      style={{
        top: placed?.top ?? position?.y ?? 0,
        left: placed?.left ?? position?.x ?? 0,
        right: "auto",
        bottom: "auto",
        margin: 0,
        maxHeight: placed?.maxHeight,
        overflowY: placed?.maxHeight != null ? "auto" : undefined,
      }}
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
 *
 * `openAt` stays for git workspace rows. `bindRow` is the dashboard path:
 * right-click, long-press (touch/pen), Shift+F10 / ContextMenu key, and a ⋮
 * via `openAtPoint`.
 */
export function useContextMenu<T>() {
  const [state, setState] = useState<{ target: T; position: ContextMenuPosition } | null>(null);
  const pressRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    target: T;
    timer: ReturnType<typeof setTimeout>;
    opened: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const close = useCallback(() => setState(null), []);

  const openAtPoint = useCallback((x: number, y: number, target: T) => {
    setState({ target, position: { x, y } });
  }, []);

  const openAt = useCallback((event: ReactMouseEvent, target: T) => {
    event.preventDefault();
    event.stopPropagation();
    openAtPoint(event.clientX, event.clientY, target);
  }, [openAtPoint]);

  const clearPress = useCallback(() => {
    const press = pressRef.current;
    if (!press) return;
    clearTimeout(press.timer);
    pressRef.current = null;
  }, []);

  const bindRow = useCallback(
    (target: T): RowMenuBind => ({
      onContextMenu: (event) => openAt(event, target),
      onPointerDown: (event) => {
        if (event.pointerType === "mouse") return;
        event.stopPropagation();
        clearPress();
        const x = event.clientX;
        const y = event.clientY;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Capture is best-effort; move/cancel still fire on the row when they can.
        }
        pressRef.current = {
          pointerId: event.pointerId,
          x,
          y,
          target,
          opened: false,
          timer: setTimeout(() => {
            const press = pressRef.current;
            if (!press || press.pointerId !== event.pointerId) return;
            press.opened = true;
            suppressClickRef.current = true;
            openAtPoint(press.x, press.y, press.target);
          }, ROW_LONG_PRESS_MS),
        };
      },
      onPointerMove: (event) => {
        const press = pressRef.current;
        if (!press || press.pointerId !== event.pointerId) return;
        const dx = event.clientX - press.x;
        const dy = event.clientY - press.y;
        if (dx * dx + dy * dy > ROW_LONG_PRESS_MOVE_PX * ROW_LONG_PRESS_MOVE_PX) {
          clearPress();
        }
      },
      onPointerUp: () => {
        const opened = pressRef.current?.opened;
        clearPress();
        if (!opened) return;
        // Some browsers never fire click after a long-press. Drop the flag so
        // the next tap on another row isn't eaten.
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 400);
      },
      onPointerCancel: () => clearPress(),
      onClick: (event) => {
        if (!suppressClickRef.current) return;
        suppressClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
      },
      onKeyDown: (event) => {
        if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        openAtPoint(rect.left + 12, rect.bottom - 4, target);
      },
    }),
    [clearPress, openAt, openAtPoint],
  );

  return {
    target: state?.target ?? null,
    position: state?.position ?? null,
    openAt,
    openAtPoint,
    bindRow,
    close,
  };
}

/** Hover-revealed ⋮ that opens the same menu as right-click / long-press. */
export function RowMenuKebab({
  label = "More actions",
  onOpen,
}: {
  label?: string;
  onOpen: (x: number, y: number) => void;
}) {
  return (
    <button
      type="button"
      className="row-menu-kebab reveal-on-hover shrink-0"
      aria-label={label}
      aria-haspopup="menu"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen(event.clientX, event.clientY);
      }}
    >
      <MoreHorizontal size={16} aria-hidden />
    </button>
  );
}

/** Quiet discoverability on a list heading — not a banner. */
export function SectionMenuHint({ className }: { className?: string } = {}) {
  return (
    <span className={["section-menu-hint", className].filter(Boolean).join(" ")}>
      Right-click · hold
    </span>
  );
}
