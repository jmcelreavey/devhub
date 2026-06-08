"use client";

import { useDesktopLauncher } from "./use-desktop-launcher";

/** Hook returning a click handler that launches the native OpenCode Desktop app. */
export function useLaunchOpenCodeDesktop() {
  return useDesktopLauncher({ endpoint: "/api/actions/launch-opencode", appName: "OpenCode" });
}
