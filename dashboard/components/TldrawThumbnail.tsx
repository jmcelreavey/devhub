"use client";

import { TldrawImage, type TLStoreSnapshot } from "tldraw";
import "tldraw/tldraw.css";
import { useTheme } from "@/components/ThemeToggle";

/**
 * Read-only preview of a persisted tldraw diagram for the diagrams list.
 * `snapshot` is the `store` field saved by TldrawCanvas — a `TLStoreSnapshot`
 * (`{ store, schema }`). Rendered lazily (ssr:false) so tldraw stays out of the
 * list bundle until there's a diagram with content to draw.
 */
export function TldrawThumbnail({ snapshot }: { snapshot: Record<string, unknown> }) {
  const { mode } = useTheme();

  return (
    <div
      className="diagram-thumb-image relative w-full aspect-square rounded overflow-hidden"
      style={{ background: "var(--bg-elevated)" }}
    >
      <TldrawImage
        snapshot={snapshot as unknown as TLStoreSnapshot}
        format="svg"
        background={false}
        padding={16}
        darkMode={mode === "dark"}
      />
    </div>
  );
}
