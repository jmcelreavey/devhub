"use client";

import type { Ref } from "react";
import { GripVertical, GripHorizontal } from "lucide-react";

type ResizeAxis = "e" | "s" | "se" | "w";

interface ResizeHandleProps extends React.HTMLAttributes<HTMLDivElement> {
  axis?: ResizeAxis;
  /** React 19 takes ref as a plain prop — no forwardRef wrapper needed. */
  ref?: Ref<HTMLDivElement>;
}

export function ResizeHandle({
  axis = "e",
  style,
  onMouseEnter,
  onMouseLeave,
  ref,
  ...props
}: ResizeHandleProps) {
  const isVertical = axis === "e" || axis === "w";
    const cursor =
      axis === "se" ? "nwse-resize" : isVertical ? "col-resize" : "row-resize";

    return (
      <div
        ref={ref}
        aria-hidden
        {...props}
        style={{
          cursor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          ...style,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = "var(--accent)";
          onMouseEnter?.(e);
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = "transparent";
          onMouseLeave?.(e);
        }}
      >
        {axis !== "se" &&
          (isVertical ? (
            <GripVertical
              size={10}
              style={{ color: "var(--text-subtle)", opacity: 0.5 }}
              aria-hidden
            />
          ) : (
            <GripHorizontal
              size={10}
              style={{ color: "var(--text-subtle)", opacity: 0.5 }}
              aria-hidden
            />
          ))}
      </div>
    );
}
