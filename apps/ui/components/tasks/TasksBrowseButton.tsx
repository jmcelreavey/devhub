"use client";

import { ListTodo } from "lucide-react";
import { useShortcutLabel } from "@/lib/hooks/use-modifier-key";
import { HoverTip } from "@/components/ui/HoverTip";

export function TasksBrowseButton() {
  const label = useShortcutLabel();
  return (
    <HoverTip label={`Tasks (${label("T", true)})`} pos="bottom-end">
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
