"use client";

import { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

export type ToastVariant = "success" | "error" | "info";

export interface ToastOptions {
  duration?: number;
  action?: { label: string; onClick: () => void };
}

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  duration: number;
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  push: (variant: ToastVariant, message: string, opts?: ToastOptions) => number;
  dismiss: (id: number) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION: Record<ToastVariant, number> = {
  success: 3500,
  info: 3500,
  error: 7000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (variant: ToastVariant, message: string, opts: ToastOptions = {}): number => {
      const id = ++idRef.current;
      const duration = opts.duration ?? DEFAULT_DURATION[variant];
      const toast: Toast = { id, message, variant, duration, action: opts.action };
      setToasts((prev) => [...prev, toast]);
      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration);
        timersRef.current.set(id, timer);
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ push, dismiss }}>
      {children}
      <div className="toast-stack" role="region" aria-live="polite" aria-label="Notifications">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon =
    toast.variant === "success" ? CheckCircle2 : toast.variant === "error" ? AlertCircle : Info;

  return (
    <div className={`toast toast-${toast.variant}`} role={toast.variant === "error" ? "alert" : "status"}>
      <Icon size={16} className="toast-icon" aria-hidden />
      <span className="toast-message">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action!.onClick();
            onDismiss();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        className="toast-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss notification"
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
