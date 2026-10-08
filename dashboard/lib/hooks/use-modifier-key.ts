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

/**
 * Labels a chord that listens for Control on every platform.
 * A Mac shows ⌃; other platforms spell Ctrl+.
 */
export function controlShortcutLabel(mac: boolean, key: string): string {
  return mac ? `⌃${key}` : `Ctrl+${key}`;
}

/** `useControlShortcutLabel()("`")` is Control-backtick for the platform showing the UI. */
export function useControlShortcutLabel(): (key: string) => string {
  const mounted = useClientMounted();
  const mac = mounted && /Macintosh|Mac OS X/.test(navigator.userAgent);
  return (key) => controlShortcutLabel(mac, key);
}
