"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Minimal pointer-based drag for arbitrary drop targets.
 *
 * HTML5 drag-and-drop is off the table — WebKit refuses to start an element
 * drag from interactive children (the lesson already written into
 * SortableList), and these sources are rows full of buttons. This hook tracks
 * one gesture on window listeners, resolves the drop with
 * `document.elementFromPoint` against a CSS selector, and exposes enough state
 * for the owner to render a ghost and highlight the hovered target.
 *
 * Escape cancels; pointercancel (trackpad palm, rotation) aborts cleanly.
 */
export interface PointerDragState<T> {
  payload: T;
  /** Viewport coordinates of the pointer — position the ghost here. */
  x: number;
  y: number;
  /** Current element under the pointer matching dropSelector, or null. */
  over: HTMLElement | null;
}

const DEFAULT_THRESHOLD_PX = 5;

export function usePointerDrag<T>(opts: {
  dropSelector: string;
  onDrop: (payload: T, target: HTMLElement, at: { x: number; y: number }) => void;
  thresholdPx?: number;
}) {
  const [state, setState] = useState<PointerDragState<T> | null>(null);
  const session = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    payload: T;
    started: boolean;
    over: HTMLElement | null;
  } | null>(null);
  const releaseGesture = useRef<(() => void) | null>(null);
  const optsRef = useRef(opts);
  // Gesture callbacks read the latest handlers without re-binding listeners.
  useEffect(() => {
    optsRef.current = opts;
  });

  const clear = useCallback(() => {
    releaseGesture.current?.();
    session.current?.over?.removeAttribute("data-drop-over");
    session.current = null;
    setState(null);
    document.body.classList.remove("sortable-dragging");
  }, []);

  const start = useCallback(
    (event: React.PointerEvent, payload: T) => {
      if (event.button !== 0) return;
      // Don't fight parent long-press/context handlers, and don't select text.
      event.stopPropagation();
      event.preventDefault();
      const pointerId = event.pointerId;
      session.current = {
        pointerId,
        originX: event.clientX,
        originY: event.clientY,
        payload,
        started: false,
        over: null,
      };

      const detach = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey);
        releaseGesture.current = null;
      };
      const onMove = (moveEvent: PointerEvent) => {
        const active = session.current;
        if (!active || moveEvent.pointerId !== active.pointerId) return;
        if (!active.started) {
          const travelled =
            Math.abs(moveEvent.clientX - active.originX) +
            Math.abs(moveEvent.clientY - active.originY);
          if (travelled < (optsRef.current.thresholdPx ?? DEFAULT_THRESHOLD_PX)) return;
          active.started = true;
          document.body.classList.add("sortable-dragging");
        }
        const hit = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
        const over = hit?.closest<HTMLElement>(optsRef.current.dropSelector) ?? null;
        if (active.over !== over) {
          active.over?.removeAttribute("data-drop-over");
          over?.setAttribute("data-drop-over", "");
        }
        active.over = over;
        setState({
          payload: active.payload,
          x: moveEvent.clientX,
          y: moveEvent.clientY,
          over,
        });
      };
      const onUp = (upEvent: PointerEvent) => {
        const active = session.current;
        if (!active || upEvent.pointerId !== active.pointerId) return;
        const { payload, started, over } = active;
        const at = { x: upEvent.clientX, y: upEvent.clientY };
        clear();
        if (started && over) optsRef.current.onDrop(payload, over, at);
      };
      const onCancel = () => clear();
      const onKey = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === "Escape") clear();
      };

      releaseGesture.current?.();
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey);
      releaseGesture.current = detach;
    },
    [clear],
  );

  // Unmounting mid-gesture must not leave listeners behind.
  useEffect(() => () => releaseGesture.current?.(), []);

  return { state, start, dragging: state !== null };
}
