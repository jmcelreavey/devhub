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

    // Packaged and Attach mode deliberately share localhost:1337. That also
    // shares the WebKit service-worker scope. Dev webpack assets have stable
    // URLs, so the production worker's cache-first `/_next/static` rule turns
    // hot reload into "whatever CSS happened to be cached first".
    //
    // A development server must never keep a worker (or its DevHub caches).
    // Unregistering makes the following reload fetch webpack assets directly.
    if (process.env.NODE_ENV === "development") {
      void (async () => {
        const registrations = await navigator.serviceWorker.getRegistrations();
        const removed = await Promise.all(registrations.map((registration) => registration.unregister()));
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames
            .filter((name) => name.startsWith("devhub-"))
            .map((name) => caches.delete(name)),
        );
        if (removed.some(Boolean)) window.location.reload();
      })();
      return;
    }

    if (!window.isSecureContext) return;
    void navigator.serviceWorker
      .register("/sw.js", { type: "classic", scope: "/" })
      .catch(() => {
        /* non-fatal — dev proxies or blocked SW still allow normal browsing */
      });
  }, []);

  return null;
}
