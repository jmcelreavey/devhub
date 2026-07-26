"use client";

import { useEffect } from "react";

/**
 * Registers a minimal pass-through service worker so Chromium can treat the
 * site as installable (manifest + SW + secure context). Safe no-op when SW
 * unsupported or context is insecure.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (!window.isSecureContext) return;

    void navigator.serviceWorker
      .register("/sw.js", { type: "classic", scope: "/" })
      .catch(() => {
        /* non-fatal — dev proxies or blocked SW still allow normal browsing */
      });
  }, []);

  return null;
}
