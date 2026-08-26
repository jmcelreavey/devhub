/**
 * Keyboard / selection helpers for the embedded xterm dock.
 * Pure logic — keep TerminalSession thin and unit-testable.
 */

export interface TerminalKeyLike {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface TerminalSelectionPos {
  start: { x: number; y: number };
  end: { x: number; y: number };
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

/**
 * Backspace sequence that removes a selection ending at the cursor on the
 * cursor’s buffer line. Returns null when the selection isn’t in-place editable
 * (scrollback / multi-line / not at cursor) — callers should only clear highlight.
 *
 * xterm `IBufferRange` coords are 1-based (see selection drag paint).
 */
export function selectionInPlaceDeleteSequence(opts: {
  selection: string;
  position: TerminalSelectionPos | null | undefined;
  /** 0-based absolute buffer row of the cursor. */
  cursorAbsY: number;
  /** 0-based cursor column. */
  cursorX: number;
}): string | null {
  const text = opts.selection;
  if (!text || !opts.position) return null;
  if (/[\r\n]/.test(text)) return null;

  const startY = opts.position.start.y - 1;
  const endY = opts.position.end.y - 1;
  const endX = opts.position.end.x - 1;
  if (startY !== endY) return null;
  if (endY !== opts.cursorAbsY) return null;
  if (endX !== opts.cursorX) return null;

  const count = [...text].length;
  if (count <= 0) return null;
  // Modern PTYs map Backspace to DEL (0x7f), matching xterm’s default.
  return "\x7f".repeat(count);
}

/** Prefer xterm selection; fall back to the DOM selection (blocks view cards). */
export function resolveTerminalCopyText(
  termSelection: string | null | undefined,
  domSelection: string | null | undefined,
): string {
  const term = termSelection?.trim() ?? "";
  if (term) return term;
  return domSelection?.trim() ?? "";
}
