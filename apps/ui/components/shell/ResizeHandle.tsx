"use client";

import type { CSSProperties, Ref } from "react";
import { GripVertical, GripHorizontal } from "lucide-react";
import { RESIZE_CURSORS, type ResizeAxis } from "@/lib/drag-resize";

const HANDLE_POSITIONS: Record<ResizeAxis, CSSProperties> = {
  n: { top: 0, left: 12, right: 12, height: 6 },
  s: { bottom: 0, left: 12, right: 12, height: 6 },
  e: { right: 0, top: 12, bottom: 12, width: 6 },
  w: { left: 0, top: 12, bottom: 12, width: 6 },
  ne: { top: 0, right: 0, width: 12, height: 12 },
  se: { bottom: 0, right: 0, width: 12, height: 12 },
  sw: { bottom: 0, left: 0, width: 12, height: 12 },
  nw: { top: 0, left: 0, width: 12, height: 12 },
};

interface ResizeHandleProps extends React.HTMLAttributes<HTMLDivElement> {
  axis?: ResizeAxis;
  /** Place an edge or corner inside its positioned parent. */
  positioned?: boolean;
  /** React 19 takes ref as a plain prop — no forwardRef wrapper needed. */
  ref?: Ref<HTMLDivElement>;
}

export function ResizeHandle({
  axis = "e",
  positioned = false,
  style,
  onMouseEnter,
  onMouseLeave,
  ref,
  ...props
}: ResizeHandleProps) {
  const isVertical = axis === "e" || axis === "w";
  const cursor = RESIZE_CURSORS[axis];

  return (
    <div
      ref={ref}
      aria-hidden
      {...props}
      data-resize-axis={axis}
      style={{
        cursor,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        touchAction: "none",
        // Corners own the intersections so diagonal resizing wins over edges.
        ...(positioned ? {
          position: "absolute",
          zIndex: axis.length === 2 ? 11 : 10,
          ...HANDLE_POSITIONS[axis],
        } : {}),
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--accent)";
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        onMouseLeave?.(e);
      }}
    >
      {axis.length === 1 &&
        (isVertical ? (
          <GripVertical
            size={10}
            style={{ color: "var(--text-subtle)", opacity: 0.5, pointerEvents: "none" }}
            aria-hidden
          />
        ) : (
          <GripHorizontal
            size={10}
            style={{ color: "var(--text-subtle)", opacity: 0.5, pointerEvents: "none" }}
            aria-hidden
          />
        ))}
    </div>
  );
}
