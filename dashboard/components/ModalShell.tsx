"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  /** Close when the backdrop is clicked. Default true. */
  dismissOnBackdrop?: boolean;
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
  dismissOnBackdrop = true,
}: ModalShellProps) {
  const titleId = useId();
  const previousFocus = useRef<HTMLElement | null>(null);

  // Hold the latest onClose in a ref so the effect below depends only on `open`.
  // Otherwise a caller passing a fresh onClose each render would re-run the
  // effect, and its cleanup would yank focus back to the pre-open element on
  // every parent re-render (e.g. while typing in a field).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus.current?.focus?.();
    };
  }, [open]);

  // Portal to <body> so the backdrop/panel escape any transformed or clipped
  // ancestor (a card grid, etc.) and center on the viewport. Only ever open
  // after a client interaction, so document is always available here.
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={`modal-backdrop fixed inset-0 z-[250] flex px-4 ${align === "top" ? "items-start justify-center pt-[12vh]" : "items-center justify-center"}`}
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={dismissOnBackdrop ? onClose : undefined}
      role="presentation"
    >
      <div
        className={`modal-panel flex max-h-[88vh] w-full flex-col ${maxWidth} rounded-xl shadow-2xl overflow-hidden`}
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold" style={{ color: "var(--text)" }}>{title}</h2>
            {description ? <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="hub-icon-btn shrink-0" aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer ? <div className="shrink-0 px-4 py-3" style={{ borderTop: "1px solid var(--border)" }}>{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
