"use client";

import { useDesktopLauncher } from "./use-desktop-launcher";

/** Hook returning a click handler that launches the native Claude app when available. */
export function useLaunchClaudeDesktop() {
  return useDesktopLauncher({ endpoint: "/api/actions/launch-claude", appName: "Claude" });
}
