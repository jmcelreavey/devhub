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
}: {
  actions: QuickMenuAction[];
  label?: string;
  /** Lets a top bar hide the whole menu at widths where the items fit inline. */
  className?: string;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const focusLast = useRef(false);

  function updateMenuPosition() {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuStyle({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
  }

  function close(restoreFocus: boolean) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    (focusLast.current ? items?.[items.length - 1] : items?.[0])?.focus();
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
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
      close(true);
      return;
    }
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "ArrowDown"
        ? (index + 1) % items.length
        : event.key === "ArrowUp"
          ? (index - 1 + items.length) % items.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    items[next]?.focus();
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
          updateMenuPosition();
          setOpen(true);
        }}
        onClick={() => {
          focusLast.current = false;
          updateMenuPosition();
          setOpen((value) => !value);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
      >
        <MoreHorizontal size={16} aria-hidden />
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
                  onClick={() => {
                    close(true);
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
