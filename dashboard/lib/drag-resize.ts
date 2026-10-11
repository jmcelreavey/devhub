/**
 * Pointer-drag resizing, the way the dashboard panels already do it.
 *
 * The shield is the important part: a full-viewport overlay swallows the
 * pointer for the duration of the drag, so it keeps tracking over an xterm
 * canvas or an iframe that would otherwise eat the events. Client-only.
 */
export interface DragResizeOptions {
  /** Cursor shown while dragging (matches the handle's axis). */
  cursor: string;
  /** Called on every move with the live pointer position. */
  onMove: (event: MouseEvent) => void;
  /** Called once when the drag ends — persist here. */
  onDone?: () => void;
}

export function startDragResize({ cursor, onMove, onDone }: DragResizeOptions): () => void {
  const shield = document.createElement("div");
  shield.style.cssText = `position:fixed;inset:0;z-index:var(--z-shield);cursor:${cursor};`;
  document.body.appendChild(shield);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    shield.remove();
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", stop);
    window.removeEventListener("blur", stop);
    onDone?.();
  };

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", stop);
  // Releasing outside the app must not leave a shield covering the dashboard.
  window.addEventListener("blur", stop);
  return stop;
}

export const RESIZE_AXES = ["n", "e", "s", "w", "ne", "se", "sw", "nw"] as const;
export type ResizeAxis = (typeof RESIZE_AXES)[number];

export const RESIZE_CURSORS: Record<ResizeAxis, string> = {
  n: "row-resize", s: "row-resize", e: "col-resize", w: "col-resize",
  ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize",
};

export interface ResizeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Keep the opposite edge fixed, including after moving a floating window. */
export function resizeRect(
  rect: ResizeRect,
  axis: ResizeAxis,
  delta: { x: number; y: number },
  bounds: ResizeRect,
  minimum: { w: number; h: number },
  maximum = { w: bounds.w, h: bounds.h },
): ResizeRect {
  const next = { ...rect };
  const west = axis.includes("w");
  const north = axis.includes("n");
  // A window moved partly off-screen can shrink without jumping back on-screen.
  const maxWidth = Math.max(rect.w, Math.min(maximum.w,
    west ? rect.x + rect.w - bounds.x : bounds.x + bounds.w - rect.x));
  const maxHeight = Math.max(rect.h, Math.min(maximum.h,
    north ? rect.y + rect.h - bounds.y : bounds.y + bounds.h - rect.y));
  if (west) {
    next.w = clampSize(rect.w - delta.x, minimum.w, maxWidth);
    next.x = rect.x + rect.w - next.w;
  } else if (axis.includes("e")) {
    next.w = clampSize(rect.w + delta.x, minimum.w, maxWidth);
  }
  if (north) {
    next.h = clampSize(rect.h - delta.y, minimum.h, maxHeight);
    next.y = rect.y + rect.h - next.h;
  } else if (axis.includes("s")) {
    next.h = clampSize(rect.h + delta.y, minimum.h, maxHeight);
  }
  return next;
}

/** Clamp a dragged dimension into a usable range. */
export function clampSize(value: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(value, min), Math.max(min, max)));
}
