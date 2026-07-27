"use client";

import { PenTool } from "lucide-react";
import { HoverTip } from "@/components/ui/HoverTip";

export function DiagramsBrowseButton() {
  return (
    <HoverTip label="Diagrams (⌘⇧D)" pos="bottom-end">
      <button
        type="button"
        className="hub-icon-btn"
        onClick={() => window.dispatchEvent(new Event("devhub:diagrams-toggle"))}
        aria-label="Open diagrams side panel"
      >
        <PenTool size={14} aria-hidden />
      </button>
    </HoverTip>
  );
}
