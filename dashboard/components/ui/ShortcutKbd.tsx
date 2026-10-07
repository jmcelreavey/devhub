"use client";

import { useShortcutLabel } from "@/lib/hooks/use-modifier-key";

/** A `<kbd>` for a modifier chord that reads ⌘ on a Mac and Ctrl elsewhere. Usable from server components. */
export function ShortcutKbd({ keys, shift = false, className }: { keys: string; shift?: boolean; className?: string }) {
  const label = useShortcutLabel();
  return <kbd className={className}>{label(keys, shift)}</kbd>;
}
