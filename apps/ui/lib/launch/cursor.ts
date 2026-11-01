"use client";

import { useDesktopLauncher } from "@/lib/hooks/use-desktop-launcher";

/** Hook returning a click handler that launches the native Cursor app when available. */
export function useLaunchCursorDesktop() {
  return useDesktopLauncher({ endpoint: "/api/actions/launch-cursor", appName: "Cursor" });
}
