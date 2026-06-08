"use client";

import { ListTodo } from "lucide-react";

export function TasksBrowseButton() {
  return (
    <button
      type="button"
      className="hub-icon-btn"
      onClick={() => window.dispatchEvent(new Event("devhub:tasks-toggle"))}
      data-tooltip="Tasks (⌘⇧T)"
      data-tooltip-pos="bottom-end"
      aria-label="Today's tasks"
    >
      <ListTodo size={14} aria-hidden />
    </button>
  );
}
