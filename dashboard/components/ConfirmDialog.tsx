"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

interface ConfirmContextValue {
  request: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const request = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const close = useCallback(
    (ok: boolean) => {
      if (pending) {
        pending.resolve(ok);
        setPending(null);
      }
    },
    [pending],
  );

  return (
    <ConfirmContext.Provider value={{ request }}>
      {children}
      {pending && <ConfirmDialogView pending={pending} onClose={close} />}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialogView({
  pending,
  onClose,
}: {
  pending: PendingConfirm;
  onClose: (ok: boolean) => void;
}) {
  const titleId = "confirm-dialog-title";
  const confirmRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="modal-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 300,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(false);
      }}
    >
      <div
        className="card modal-panel"
        style={{
          width: "100%",
          maxWidth: 420,
          padding: 20,
          background: "var(--bg-surface)",
        }}
      >
        <h2 id={titleId} style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
          {pending.title}
        </h2>
        {pending.message && (
          <p style={{ margin: "8px 0 16px", color: "var(--text-muted)", fontSize: 13 }}>
            {pending.message}
          </p>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="btn btn-ghost" onClick={() => onClose(false)}>
            {pending.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={pending.variant === "danger" ? "btn btn-danger-ghost" : "btn btn-primary"}
            onClick={() => onClose(true)}
          >
            {pending.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  return useCallback(
    (opts: ConfirmOptions): Promise<boolean> => {
      if (!ctx) {
        // Safe fallback if provider isn't mounted (e.g. in tests)
        return Promise.resolve(window.confirm(opts.message ?? opts.title));
      }
      return ctx.request(opts);
    },
    [ctx],
  );
}
