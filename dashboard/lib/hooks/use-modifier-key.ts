"use client";

import { useClientMounted } from "./use-client-mounted";

/** Match the device displaying the UI, which can differ from the WSL server. */
export function useModifierKey(): string {
  const mounted = useClientMounted();
  return mounted && /Macintosh|Mac OS X/.test(navigator.userAgent) ? "⌘" : "Ctrl+";
}
