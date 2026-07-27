"use client";

import { ListTodo } from "lucide-react";
import { HoverTip } from "@/components/ui/HoverTip";

export function TasksBrowseButton() {
  return (
    <HoverTip label="Tasks (⌘⇧T)" pos="bottom-end">
      <button
        type="button"
        className="hub-icon-btn"
        onClick={() => window.dispatchEvent(new Event("devhub:tasks-toggle"))}
        aria-label="Today's tasks"
      >
        <ListTodo size={14} aria-hidden />
      </button>
    </HoverTip>
  );
}
