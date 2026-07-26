"use client";

import { useDesktopLauncher } from "@/lib/hooks/use-desktop-launcher";

/** Hook returning a click handler that launches the native OpenChamber Desktop app. */
export function useLaunchChamberDesktop() {
  return useDesktopLauncher({ endpoint: "/api/actions/launch-chamber", appName: "OpenChamber" });
}
