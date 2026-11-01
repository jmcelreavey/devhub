"use client";

import { useEffect } from "react";
import { removeDevhubServiceWorkers } from "@/lib/desktop/service-worker";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void removeDevhubServiceWorkers(
      navigator.serviceWorker,
      typeof caches === "undefined" ? undefined : caches,
    )
      .then((removed) => {
        if (removed && navigator.serviceWorker.controller) window.location.reload();
      })
      .catch((error: unknown) => {
        console.error("Could not remove the old DevHub service worker", error);
      });
  }, []);

  return null;
}
