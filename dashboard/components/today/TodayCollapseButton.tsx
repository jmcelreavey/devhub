"use client";

import { ChevronDown } from "lucide-react";

interface TodayCollapseButtonProps {
  collapsed: boolean;
  label: string;
  onToggle: () => void;
}

export function TodayCollapseButton({ collapsed, label, onToggle }: TodayCollapseButtonProps) {
  const action = collapsed ? "Expand" : "Collapse";

  return (
    <button
      type="button"
      className="today-collapse-toggle today-grid-drag-cancel"
      aria-label={`${action} ${label}`}
      aria-expanded={!collapsed}
      title={`${action} ${label}`}
      onClick={onToggle}
    >
      <ChevronDown
        size={15}
        aria-hidden
        className="today-collapse-toggle-chevron"
        data-collapsed={collapsed ? "true" : undefined}
      />
    </button>
  );
}
