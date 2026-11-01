"use client";

import { PenTool } from "lucide-react";
import { useShortcutLabel } from "@/lib/hooks/use-modifier-key";
import { HoverTip } from "@/components/ui/HoverTip";

export function DiagramsBrowseButton() {
  const label = useShortcutLabel();
  return (
    <HoverTip label={`Diagrams (${label("D", true)})`} pos="bottom-end">
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
