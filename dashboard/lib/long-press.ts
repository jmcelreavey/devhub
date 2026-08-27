/**
 * Touch/pen long-press gesture — the single implementation.
 *
 * This existed three times: twice in `lib/palette-row-press.ts` (a pure factory
 * that only the test called, and a hook that shipped — so the tested copy was
 * not the running copy) and once inline in `useContextMenu().bindRow`. Same
 * timer, same movement cancel, same click-suppression dance, three chances to
 * drift.
 *
 * Mouse is deliberately excluded: a mouse has right-click and Shift-click, and
 * hijacking press-and-hold there breaks text selection.
 */

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useState } from "react";

export const ROW_LONG_PRESS_MS = 500;
export const ROW_LONG_PRESS_MOVE_PX = 8;

/**
 * Some browsers never fire `click` after a long-press. Drop the suppression
 * flag shortly after release so the next tap on another row isn't eaten.
 */
const SUPPRESS_CLICK_RELEASE_MS = 400;

export interface LongPressPoint {
  x: number;
  y: number;
  /** The element the gesture started on — menus anchor to it. */
  host: HTMLElement;
}

export interface LongPressState {
  pointerId: number;
  x: number;
  y: number;
  host: HTMLElement;
  timer: ReturnType<typeof setTimeout>;
  opened: boolean;
}

export interface LongPressRefs {
  press: { current: LongPressState | null };
  suppressClick: { current: boolean };
}

export interface LongPressOptions {
  onLongPress: (point: LongPressPoint) => void;
  /** Called on a plain tap/click. Omit when the host handles clicks itself. */
  onTap?: () => void;
  /** Keep the gesture from also starting one on an ancestor row. */
  stopPropagation?: boolean;
}

export interface LongPressBind {
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: (event: ReactPointerEvent) => void;
  onPointerCancel: (event: ReactPointerEvent) => void;
  onClick: (event: ReactMouseEvent) => void;
}

/** Pure factory — the hook wraps this, so tests exercise the shipped code path. */
export function createLongPressBind(opts: LongPressOptions, refs: LongPressRefs): LongPressBind {
  const clearPress = () => {
    const press = refs.press.current;
    if (!press) return;
    clearTimeout(press.timer);
    refs.press.current = null;
  };

  return {
    onPointerDown: (event) => {
      if (event.pointerType === "mouse") return;
      if (opts.stopPropagation) event.stopPropagation();
      clearPress();
      const x = event.clientX;
      const y = event.clientY;
      const host = event.currentTarget as HTMLElement;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Capture is best-effort; move/cancel still fire on the row when they can.
      }
      refs.press.current = {
        pointerId: event.pointerId,
        x,
        y,
        host,
        opened: false,
        timer: setTimeout(() => {
          const press = refs.press.current;
          if (!press || press.pointerId !== event.pointerId) return;
          press.opened = true;
          refs.suppressClick.current = true;
          opts.onLongPress({ x: press.x, y: press.y, host: press.host });
        }, ROW_LONG_PRESS_MS),
      };
    },
    onPointerMove: (event) => {
      const press = refs.press.current;
      if (!press || press.pointerId !== event.pointerId) return;
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      if (dx * dx + dy * dy > ROW_LONG_PRESS_MOVE_PX * ROW_LONG_PRESS_MOVE_PX) {
        clearPress();
      }
    },
    onPointerUp: () => {
      const opened = refs.press.current?.opened;
      clearPress();
      if (!opened) return;
      window.setTimeout(() => {
        refs.suppressClick.current = false;
      }, SUPPRESS_CLICK_RELEASE_MS);
    },
    onPointerCancel: () => clearPress(),
    onClick: (event) => {
      if (refs.suppressClick.current) {
        refs.suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      opts.onTap?.();
    },
  };
}

/**
 * React binding for {@link createLongPressBind} — owns the gesture state, nothing else.
 *
 * The holders are plain mutable objects behind a lazy `useState`, not `useRef`:
 * they are read only inside event handlers, never during render, and keeping
 * them out of `useRef` says so to both the reader and the lint rule.
 */
export function useLongPress(opts: LongPressOptions): LongPressBind {
  const [refs] = useState<LongPressRefs>(() => ({
    press: { current: null },
    suppressClick: { current: false },
  }));
  return createLongPressBind(opts, refs);
}
