"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

export interface LaunchMenuItem {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  onSelect: () => void | Promise<void>;
}

export function LaunchMenu({
  label,
  icon,
  items,
  align = "right",
  buttonClassName = "btn btn-ghost",
  buttonStyle,
}: {
  label: string;
  icon?: ReactNode;
  items: LaunchMenuItem[];
  align?: "left" | "right";
  buttonClassName?: string;
  buttonStyle?: CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function updateMenuPosition() {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuStyle({
      top: rect.bottom + 6,
      ...(align === "right" ? { right: Math.max(8, window.innerWidth - rect.right) } : { left: Math.max(8, rect.left) }),
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
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
    // Position is derived from the trigger when the menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div ref={rootRef} className="launch-menu-wrap">
      <button
        type="button"
        className={buttonClassName}
        style={buttonStyle}
        onClick={() => {
          updateMenuPosition();
          setOpen((value) => !value);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {icon}
        <span>{label}</span>
        <ChevronDown size={12} aria-hidden />
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div ref={menuRef} className="launch-menu" role="menu" style={menuStyle}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="launch-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void item.onSelect();
              }}
            >
              {item.icon && <span className="launch-menu-icon">{item.icon}</span>}
              <span className="launch-menu-copy">
                <span className="launch-menu-label">{item.label}</span>
                {item.description && <span className="launch-menu-description">{item.description}</span>}
              </span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
