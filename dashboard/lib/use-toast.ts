"use client";

import { useContext, useMemo } from "react";
import { ToastContext, type ToastOptions } from "@/components/ToastProvider";

export function useToast() {
  const ctx = useContext(ToastContext);
  return useMemo(
    () => ({
      success: (message: string, opts?: ToastOptions) => ctx?.push("success", message, opts) ?? 0,
      error: (message: string, opts?: ToastOptions) => ctx?.push("error", message, opts) ?? 0,
      info: (message: string, opts?: ToastOptions) => ctx?.push("info", message, opts) ?? 0,
      dismiss: (id: number) => ctx?.dismiss(id),
    }),
    [ctx],
  );
}
