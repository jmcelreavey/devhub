"use client";

import { PenTool } from "lucide-react";

export function DiagramsBrowseButton() {
  return (
    <button
      type="button"
      className="hub-icon-btn"
      onClick={() => window.dispatchEvent(new Event("devhub:diagrams-toggle"))}
      data-tooltip="Diagrams (⌘⇧D)"
      data-tooltip-pos="bottom-end"
      aria-label="Open diagrams side panel"
    >
      <PenTool size={14} aria-hidden />
    </button>
  );
}
