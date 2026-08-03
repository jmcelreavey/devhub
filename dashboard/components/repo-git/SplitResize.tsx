"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

interface RepoSplitProps {
  /** Primary (leading) pane fraction of the container, 0–1. */
  primaryFr: number;
  onPrimaryFrChange: (fr: number) => void;
  minPrimaryFr?: number;
  maxPrimaryFr?: number;
  primary: ReactNode;
  secondary: ReactNode;
  className?: string;
  handleLabel: string;
  /** When true, collapse to a single column (no handle). */
  stacked?: boolean;
}

/** Arrow-key nudge, as a fraction of the container. Shift moves in bigger jumps. */
const KEY_STEP = 0.02;
const KEY_STEP_LARGE = 0.1;

const DRAG_FLAG = "repoGitSplitDragging";

/**
 * Two-pane horizontal split with a draggable gutter.
 * Uses CSS grid + fr so both panes stay flexible under the parent height.
 */
export function RepoSplit({
  primaryFr,
  onPrimaryFrChange,
  minPrimaryFr = 0.18,
  maxPrimaryFr = 0.72,
  primary,
  secondary,
  className,
  handleLabel,
  stacked = false,
}: RepoSplitProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startFr: number; width: number } | null>(null);

  const clamp = useCallback(
    (fr: number) => Math.min(maxPrimaryFr, Math.max(minPrimaryFr, fr)),
    [maxPrimaryFr, minPrimaryFr],
  );

  // Unmounting mid-drag (closing the modal while dragging) would otherwise leave
  // the global drag flag — and its cursor / user-select overrides — stuck on.
  useEffect(() => () => {
    delete document.body.dataset[DRAG_FLAG];
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (stacked) return;
      const root = rootRef.current;
      if (!root) return;
      e.preventDefault();
      const rect = root.getBoundingClientRect();
      dragRef.current = { startX: e.clientX, startFr: primaryFr, width: rect.width };
      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.dataset[DRAG_FLAG] = "1";
    },
    [primaryFr, stacked],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.width <= 0) return;
      onPrimaryFrChange(clamp(drag.startFr + (e.clientX - drag.startX) / drag.width));
    },
    [clamp, onPrimaryFrChange],
  );

  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    delete document.body.dataset[DRAG_FLAG];
  }, []);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onPrimaryFrChange(clamp(primaryFr - step));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onPrimaryFrChange(clamp(primaryFr + step));
      } else if (e.key === "Home") {
        e.preventDefault();
        onPrimaryFrChange(minPrimaryFr);
      } else if (e.key === "End") {
        e.preventDefault();
        onPrimaryFrChange(maxPrimaryFr);
      }
    },
    [clamp, maxPrimaryFr, minPrimaryFr, onPrimaryFrChange, primaryFr],
  );

  const style: CSSProperties | undefined = stacked
    ? undefined
    : {
        gridTemplateColumns: `minmax(0, ${primaryFr}fr) 5px minmax(0, ${1 - primaryFr}fr)`,
      };

  return (
    <div
      ref={rootRef}
      className={`repo-git-split${className ? ` ${className}` : ""}${stacked ? " repo-git-split-stacked" : ""}`}
      style={style}
    >
      <div className="repo-git-split-pane">{primary}</div>
      {!stacked ? (
        // role="separator" + aria-value* is the ARIA window-splitter pattern; a
        // plain <button> announced as "press to activate" and ignored arrow keys.
        <div
          className="repo-git-split-handle"
          role="separator"
          tabIndex={0}
          aria-label={handleLabel}
          aria-orientation="vertical"
          aria-valuenow={Math.round(primaryFr * 100)}
          aria-valuemin={Math.round(minPrimaryFr * 100)}
          aria-valuemax={Math.round(maxPrimaryFr * 100)}
          title={`${handleLabel} (arrow keys to adjust)`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
        />
      ) : null}
      <div className="repo-git-split-pane">{secondary}</div>
    </div>
  );
}
