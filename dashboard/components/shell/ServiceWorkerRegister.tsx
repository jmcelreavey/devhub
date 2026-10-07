"use client";

import { useEffect } from "react";
import { isDesktop } from "@/lib/desktop/bridge";
import { removeDevhubServiceWorkers, serviceWorkerPlan } from "@/lib/desktop/service-worker";

/**
 * Registers the offline service worker in a normal browser, and removes it
 * where it does harm: development servers and the desktop shell. See
 * `serviceWorkerPlan` for why each case is what it is.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const development = process.env.NODE_ENV === "development";
    const plan = serviceWorkerPlan({
      development,
      desktop: isDesktop(),
      secureContext: window.isSecureContext,
    });

    if (plan === "remove") {
      void (async () => {
        const removed = await removeDevhubServiceWorkers(
          navigator.serviceWorker,
          typeof caches === "undefined" ? undefined : caches,
        );
        // Development reloads so webpack assets are fetched directly. The
        // desktop shell does not need to: this page already loaded, and the
        // next launch's bootstrap navigation is no longer intercepted.
        if (removed && development) window.location.reload();
      })().catch(() => {
        /* non-fatal — the worst case is the old worker lingering */
      });
      return;
    }

    if (plan !== "register") return;
    void navigator.serviceWorker
      .register("/sw.js", { type: "classic", scope: "/" })
      .catch(() => {
        /* non-fatal — dev proxies or blocked SW still allow normal browsing */
      });
  }, []);

  return null;
}
