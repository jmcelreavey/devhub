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

  const stop = () => {
    shield.remove();
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", stop);
    onDone?.();
  };

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", stop);
  return stop;
}

/** Clamp a dragged dimension into a usable range. */
export function clampSize(value: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(value, min), Math.max(min, max)));
}
