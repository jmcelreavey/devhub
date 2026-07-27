"use client";

import { FolderOpen } from "lucide-react";
import { HoverTip } from "@/components/ui/HoverTip";

export function NotesBrowseButton() {
  return (
    <HoverTip label="Notes (⌘⇧O)" pos="bottom-end">
      <button
        type="button"
        className="hub-icon-btn"
        onClick={() => window.dispatchEvent(new Event("devhub:notes-toggle"))}
        aria-label="Open notes side panel"
      >
        <FolderOpen size={14} aria-hidden />
      </button>
    </HoverTip>
  );
}
