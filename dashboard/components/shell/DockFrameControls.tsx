"use client";

import { Columns2, PictureInPicture2 } from "lucide-react";
import { HoverTip } from "@/components/ui/HoverTip";
import type { DockFrame } from "@/lib/terminal-dock-state";

/**
 * Window controls for the terminal dock.
 *
 * These used to live inside AgentStatusStrip, which only renders for Agent
 * tabs — so a plain shell tab had no way to pop out, maximise or minimise, and
 * two panes in the same dock had visibly different chrome. The dock is what is
 * being framed, so the buttons belong to the dock and every tab gets them.
 *
 * Each handler is optional: pass only the affordances that apply (Split is
 * hidden when there is no Agent tab to split with).
 *
 * Maximise/minimise used to live here and were removed: neither had a discoverable
 * way back, and both are covered by dragging an edge, which is reversible.
 */
export function DockFrameControls({
  frame,
  onSplit,
  onPopOut,
}: {
  frame: DockFrame;
  onSplit?: () => void;
  onPopOut?: () => void;
}) {
  return (
    <div className="dock-frame-controls">
      {onSplit ? (
        <HoverTip label={frame === "split" ? "Unsplit" : "Split with Agent"} pos="top-end">
          <button
            type="button"
            className="hub-icon-btn terminal-dock-btn"
            aria-label={frame === "split" ? "Unsplit" : "Split with Agent"}
            aria-pressed={frame === "split"}
            onClick={onSplit}
          >
            <Columns2 size={12} aria-hidden />
          </button>
        </HoverTip>
      ) : null}
      {onPopOut ? (
        <HoverTip label={frame === "popout" ? "Dock" : "Pop out"} pos="top-end">
          <button
            type="button"
            className="hub-icon-btn terminal-dock-btn"
            aria-label={frame === "popout" ? "Return to dock" : "Pop out"}
            aria-pressed={frame === "popout"}
            onClick={onPopOut}
          >
            <PictureInPicture2 size={12} aria-hidden />
          </button>
        </HoverTip>
      ) : null}
    </div>
  );
}
