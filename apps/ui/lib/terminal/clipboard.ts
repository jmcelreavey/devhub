/**
 * Keyboard / selection helpers for the embedded terminal dock.
 */

export interface TerminalKeyLike {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** True on Apple platforms where ⌘ is the primary accelerator. */
export function isAppleTerminalPlatform(
  platform = typeof navigator !== "undefined" ? navigator.platform : "",
  userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "",
): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS X/i.test(userAgent);
}

function modChord(e: TerminalKeyLike, isApple: boolean): boolean {
  if (e.altKey) return false;
  return isApple ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

/** ⌘/Ctrl+C, or Ctrl+Shift+C on non-Apple (when ⌘C isn’t available). */
export function isTerminalCopyShortcut(e: TerminalKeyLike, isApple: boolean): boolean {
  if (e.key.toLowerCase() !== "c") return false;
  if (!modChord(e, isApple)) return false;
  // Apple: ⌘C. Others: Ctrl+C (copy-when-selected) or Ctrl+Shift+C.
  return isApple ? !e.shiftKey : true;
}

/** ⌘/Ctrl+X, or Ctrl+Shift+X on non-Apple. */
export function isTerminalCutShortcut(e: TerminalKeyLike, isApple: boolean): boolean {
  if (e.key.toLowerCase() !== "x") return false;
  if (!modChord(e, isApple)) return false;
  return isApple ? !e.shiftKey : true;
}

/**
 * Explicit paste chords that often bypass the browser paste event.
 * Native ⌘/Ctrl+V is left to the textarea so image paste still works.
 */
export function isTerminalShiftPasteShortcut(e: TerminalKeyLike, isApple: boolean): boolean {
  if (e.key.toLowerCase() !== "v") return false;
  if (!e.shiftKey) return false;
  return modChord(e, isApple);
}

/** Prefer terminal selection; fall back to the DOM selection. */
export function resolveTerminalCopyText(
  termSelection: string | null | undefined,
  domSelection: string | null | undefined,
): string {
  if (termSelection) return termSelection;
  return domSelection ?? "";
}
