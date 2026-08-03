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
  /** Close when the backdrop is clicked. Default true. */
  dismissOnBackdrop?: boolean;
}

/**
 * Modal shell via native `<dialog showModal()>` so it stacks in the browser
 * top layer above other modal dialogs (Git workspace, etc.). A body-portal
 * div with z-index loses to top-layer and looks like a no-op click.
 */
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
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
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
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }

    previousFocus.current = document.activeElement as HTMLElement | null;
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      onCloseRef.current();
      return;
    }

    // Escape is handled by the dialog's own `cancel` event (see onCancel below),
    // not a document listener. A document listener fires for every open dialog at
    // once, so Escape in a stacked modal — the maximized diff inside the Git
    // workspace — used to collapse the whole stack instead of the top layer.
    return () => {
      if (dialog.open) dialog.close();
      previousFocus.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      className={`modal-shell-dialog ${align === "top" ? "modal-shell-dialog-top" : ""}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-modal="true"
      onCancel={(e) => {
        // Fires only on the topmost open dialog, so stacked modals close one at a time.
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal-panel flex max-h-[88vh] w-full flex-col ${maxWidth} rounded-xl shadow-2xl overflow-hidden`}
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex shrink-0 items-start justify-between gap-3 px-4 py-3"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold text-text">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="text-xs mt-1 text-text-muted">
                {description}
              </p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="hub-icon-btn shrink-0" aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer ? (
          <div className="shrink-0 px-4 py-3" style={{ borderTop: "1px solid var(--border)" }}>
            {footer}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
