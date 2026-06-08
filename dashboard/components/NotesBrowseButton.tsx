"use client";

import { FolderOpen } from "lucide-react";

export function NotesBrowseButton() {
  return (
    <button
      type="button"
      className="hub-icon-btn"
      onClick={() => window.dispatchEvent(new Event("devhub:notes-toggle"))}
      data-tooltip="Notes (⌘⇧O)"
      data-tooltip-pos="bottom-end"
      aria-label="Open notes side panel"
    >
      <FolderOpen size={14} aria-hidden />
    </button>
  );
}
