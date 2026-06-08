"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  maxWidth?: string;
  align?: "center" | "top";
  footer?: ReactNode;
}

export function ModalShell({
  open,
  onClose,
  title,
  description,
  children,
  maxWidth = "max-w-lg",
  align = "center",
  footer,
}: ModalShellProps) {
  const titleId = useId();
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 z-[250] flex px-4 ${align === "top" ? "items-start justify-center pt-[12vh]" : "items-center justify-center"}`}
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={onClose}
      role="presentation"
    >
      <div
        className={`w-full ${maxWidth} rounded-xl shadow-2xl overflow-hidden`}
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold" style={{ color: "var(--text)" }}>{title}</h2>
            {description ? <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="hub-icon-btn shrink-0" aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="p-4">{children}</div>
        {footer ? <div className="px-4 py-3" style={{ borderTop: "1px solid var(--border)" }}>{footer}</div> : null}
      </div>
    </div>
  );
}
