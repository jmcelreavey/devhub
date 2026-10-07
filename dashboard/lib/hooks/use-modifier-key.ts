"use client";

import { useClientMounted } from "./use-client-mounted";

/** Match the device displaying the UI, which can differ from the WSL server. */
export function useModifierKey(): string {
  const mounted = useClientMounted();
  return mounted && /Macintosh|Mac OS X/.test(navigator.userAgent) ? "⌘" : "Ctrl+";
}

/** `⌘⇧O` on a Mac, `Ctrl+Shift+O` elsewhere. `modifier` comes from `useModifierKey()`. */
export function shortcutLabel(modifier: string, key: string, shift = false): string {
  if (modifier === "⌘") return `${modifier}${shift ? "⇧" : ""}${key}`;
  return `${modifier}${shift ? "Shift+" : ""}${key}`;
}

/** Shortcut labels for the device showing the UI: `const label = useShortcutLabel(); label("O", true)`. */
export function useShortcutLabel(): (key: string, shift?: boolean) => string {
  const modifier = useModifierKey();
  return (key, shift = false) => shortcutLabel(modifier, key, shift);
}
