"use client";

import { useDesktopLauncher } from "@/lib/hooks/use-desktop-launcher";

/** Hook returning a click handler that launches the native ChatGPT app when available. */
export function useLaunchChatGPTDesktop() {
  return useDesktopLauncher({ endpoint: "/api/actions/launch-chatgpt", appName: "ChatGPT" });
}
