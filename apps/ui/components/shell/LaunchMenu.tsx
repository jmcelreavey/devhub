"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { clampMenuPosition, menuGroupsWithDangerLast, readViewportSize, type ContextMenuGroup } from "./ContextMenu";

export interface LaunchMenuItem {
  id: string;
  label: string;
  description?: string;
  section?: string;
  icon?: ReactNode;
  danger?: boolean;
  onSelect: () => void | Promise<void>;
}

export function groupLaunchMenuItems(items: LaunchMenuItem[], sections: string[] = []): ContextMenuGroup[] {
  const labels = [...new Set([...sections, ...items.map((item) => item.section ?? "")])];
  return menuGroupsWithDangerLast(labels.map((label) => ({
    id: label || "actions",
    label: label || undefined,
    items: items.filter((item) => (item.section ?? "") === label),
  })));
}

/**
 * Dropdown launcher. Uses the Popover API so the menu enters the browser
 * top layer — required when the trigger sits inside a modal `<dialog>`
 * (e.g. Git workspace). Plain `position:fixed` + z-index loses to top-layer.
 */
export function LaunchMenu({
  label,
  hideLabel = false,
  icon,
  items,
  sections,
  align = "right",
  buttonClassName = "btn btn-ghost",
  buttonStyle,
  disabled = false,
}: {
  label: string;
  hideLabel?: boolean;
  icon?: ReactNode;
  items: LaunchMenuItem[];
  sections?: string[];
  align?: "left" | "right";
  buttonClassName?: string;
  buttonStyle?: CSSProperties;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const typeahead = useRef({ text: "", at: 0 });
  const groups = groupLaunchMenuItems(items, sections);

  const updateMenuPosition = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const size = menuRef.current?.getBoundingClientRect();
    const placed = clampMenuPosition(
      align === "right" ? rect.right - (size?.width || 230) : rect.left,
      rect.bottom + 6,
      { width: size?.width || 230, height: size?.height || 0 },
      readViewportSize(),
    );
    setMenuStyle({ ...placed, right: "auto", bottom: "auto", margin: 0, overflowY: "auto" });
  }, [align]);

  /** Menu items in DOM order — the roving focus targets. */
  const itemNodes = useCallback(
    () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>(".launch-menu-item") ?? []),
    [],
  );

  const focusItemAt = useCallback(
    (index: number) => {
      const nodes = itemNodes();
      if (nodes.length === 0) return;
      const wrapped = ((index % nodes.length) + nodes.length) % nodes.length;
      const options: FocusOptions & { focusVisible?: boolean } = {
        preventScroll: true,
        focusVisible: true,
      };
      nodes[wrapped]?.focus(options);
      nodes[wrapped]?.scrollIntoView?.({ block: "nearest" });
    },
    [itemNodes],
  );

  /** Close and hand focus back to the trigger, so keyboard users aren't dumped at <body>. */
  const closeAndRestoreFocus = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const supportsPopover = typeof menu.showPopover === "function";

    if (open) {
      typeahead.current = { text: "", at: 0 };
      updateMenuPosition();
      if (supportsPopover) {
        try {
          if (!menu.matches(":popover-open")) menu.showPopover();
        } catch {
          // Ignored — fall through to visibility via [open] attribute styling.
        }
      }
    } else if (supportsPopover) {
      try {
        if (menu.matches(":popover-open")) menu.hidePopover();
      } catch {
        // already closed
      }
    }

    if (!open) return;
    updateMenuPosition();

    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    // Capture phase + stopPropagation so Escape dismisses only this menu. Without
    // it the keypress also reached the enclosing <dialog>, and closing the "Open
    // with" menu tore down the whole diff modal behind it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      closeAndRestoreFocus();
    };
    const onToggle = (event: Event) => {
      const te = event as ToggleEvent;
      if (te.newState === "closed") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    menu.addEventListener("toggle", onToggle);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
      menu.removeEventListener("toggle", onToggle);
    };
  }, [open, updateMenuPosition, closeAndRestoreFocus]);

  /** Open (if needed) and land focus on the first or last item. */
  function openWithFocus(edge: "first" | "last") {
    updateMenuPosition();
    setOpen(true);
    requestAnimationFrame(() => focusItemAt(edge === "first" ? 0 : itemNodes().length - 1));
  }

  return (
    <div ref={rootRef} className="launch-menu-wrap">
      <button
        ref={triggerRef}
        type="button"
        className={buttonClassName}
        style={buttonStyle}
        disabled={disabled}
        onClick={() => {
          updateMenuPosition();
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openWithFocus(event.key === "ArrowDown" ? "first" : "last");
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
      >
        {icon}
        <span className={hideLabel ? "sr-only" : undefined}>{label}</span>
        <ChevronDown size={12} aria-hidden />
      </button>
      <div
        ref={menuRef}
        id={menuId}
        className="launch-menu"
        role="menu"
        aria-label={label}
        style={menuStyle}
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
            // Tabbing out of a menu closes it rather than walking the page behind.
            closeAndRestoreFocus();
          } else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
            const now = event.timeStamp;
            const key = event.key.toLocaleLowerCase();
            const previous = now - typeahead.current.at < 700 ? typeahead.current.text : "";
            const text = previous === key ? key : previous + key;
            typeahead.current = { text, at: now };
            const offset = text.length > 1 ? 0 : 1;
            for (let step = offset; step < nodes.length + offset; step += 1) {
              const index = (Math.max(current, text.length > 1 ? 0 : -1) + step) % nodes.length;
              const label = nodes[index].querySelector(".launch-menu-label")?.textContent ?? "";
              if (label.trim().toLocaleLowerCase().startsWith(text)) {
                event.preventDefault();
                focusItemAt(index);
                break;
              }
            }
          }
        }}
        {...({ popover: "manual" } as { popover?: "manual" })}
      >
        {groups.map((group, index) => (
          <div key={group.id} className="context-menu-group">
            {index > 0 && <div className="context-menu-divider" role="separator" />}
            {group.label && <div className="context-menu-group-label">{group.label}</div>}
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="launch-menu-item"
                data-danger={item.danger ? "true" : undefined}
                role="menuitem"
                title={item.description}
                onClick={() => {
                  closeAndRestoreFocus();
                  void item.onSelect();
                }}
              >
                {item.icon && <span className="launch-menu-icon">{item.icon}</span>}
                <span className="launch-menu-copy">
                  <span className="launch-menu-label">{item.label}</span>
                  {item.description && (
                    <span className="launch-menu-description">{item.description}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
