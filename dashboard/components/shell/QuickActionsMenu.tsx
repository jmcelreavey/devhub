"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

/** WebKit ignores :focus-visible on element.focus() unless focusVisible is set. */
function moveFocus(el: HTMLElement | null | undefined, visible = false) {
  const options: FocusOptions & { focusVisible?: boolean } = {
    preventScroll: true,
    focusVisible: visible,
  };
  el?.focus(options);
}

export interface QuickMenuAction {
  id: string;
  label: string;
  icon: ReactNode;
  /** Window event the matching panel/dock listens for. */
  event?: string;
  /** Route to open instead of firing an event. */
  href?: string;
  /** Shortcut shown beside the label, so the menu teaches the keyboard route. */
  shortcut?: string;
}

/**
 * Overflow menu shared by the mobile and desktop top bars. Items either fire
 * the window event the matching panel/dock listens for or navigate — the
 * panels stay the single source of truth for behaviour.
 */
export function QuickActionsMenu({
  actions,
  label = "Quick actions",
  className,
  triggerLabel,
  icon,
}: {
  actions: QuickMenuAction[];
  label?: string;
  /** Lets a top bar hide the whole menu at widths where the items fit inline. */
  className?: string;
  triggerLabel?: string;
  /** Replaces the ellipsis. The mobile bar keeps the default overflow glyph. */
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const focusLast = useRef(false);
  // A pointer open focuses the menu itself, not an item: a focused item reads
  // as keyboard focus in WebKit (the trigger never took focus on click), which
  // is what drew a ring on "Notes" the moment the menu opened.
  const openedByPointer = useRef(false);

  function updateMenuPosition() {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuStyle({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
  }

  function close(restoreFocus: boolean, focusVisible = false) {
    setOpen(false);
    if (!restoreFocus) return;
    moveFocus(triggerRef.current, focusVisible);
  }

  useEffect(() => {
    if (!open) return;
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (openedByPointer.current) moveFocus(menuRef.current);
    else moveFocus(focusLast.current ? items?.[items.length - 1] : items?.[0], true);
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      moveFocus(triggerRef.current, true);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // Container changes (including sidebar collapse) do not fire window resize.
    const observer = new ResizeObserver(() => {
      if (!triggerRef.current?.getClientRects().length) setOpen(false);
      else updateMenuPosition();
    });
    if (rootRef.current) {
      observer.observe(rootRef.current);
      const header = rootRef.current.closest("header");
      if (header) observer.observe(header);
    }
    window.addEventListener("resize", updateMenuPosition);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      observer.disconnect();
      window.removeEventListener("resize", updateMenuPosition);
    };
  }, [open]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      // Let native Tab continue from the trigger, not the body portal.
      close(true, true);
      return;
    }
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    // index is -1 while the menu itself holds focus (pointer open): ArrowDown
    // lands on the first item and ArrowUp on the last.
    const next =
      event.key === "ArrowDown"
        ? (index + 1) % items.length
        : event.key === "ArrowUp"
          ? index < 0
            ? items.length - 1
            : (index - 1 + items.length) % items.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    moveFocus(items[next], true);
  }

  return (
    <div ref={rootRef} className={className ? `launch-menu-wrap ${className}` : "launch-menu-wrap"}>
      <button
        ref={triggerRef}
        type="button"
        className="hub-icon-btn"
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          focusLast.current = event.key === "ArrowUp";
          openedByPointer.current = false;
          updateMenuPosition();
          setOpen(true);
        }}
        onClick={(event) => {
          focusLast.current = false;
          // detail is 0 for Enter/Space (and script clicks), the click count for a pointer.
          openedByPointer.current = event.detail > 0;
          updateMenuPosition();
          setOpen((value) => !value);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
      >
        {icon ?? <MoreHorizontal size={16} aria-hidden />}
        {triggerLabel && <span>{triggerLabel}</span>}
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            className="launch-menu"
            role="menu"
            tabIndex={-1}
            aria-label={label}
            style={menuStyle}
            onKeyDown={onMenuKeyDown}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget) &&
                  !rootRef.current?.contains(event.relatedTarget)) setOpen(false);
            }}
          >
            {actions.map((action) => {
              const content = (
                <>
                  <span className="launch-menu-icon">{action.icon}</span>
                  <span className="launch-menu-copy">
                    <span className="launch-menu-label">{action.label}</span>
                  </span>
                  {action.shortcut && (
                    <kbd className="launch-menu-kbd" aria-hidden>
                      {action.shortcut}
                    </kbd>
                  )}
                </>
              );
              if (action.href) {
                return (
                  <Link
                    key={action.id}
                    href={action.href}
                    className="launch-menu-item"
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => close(false)}
                  >
                    {content}
                  </Link>
                );
              }
              return (
                <button
                  key={action.id}
                  type="button"
                  className="launch-menu-item"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={(event) => {
                    close(true, event.detail === 0);
                    if (action.event) window.dispatchEvent(new CustomEvent(action.event));
                  }}
                >
                  {content}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
