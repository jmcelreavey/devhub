"use client";

import { FolderOpen, ListTodo, PenTool, Settings } from "lucide-react";
import { useShortcutLabel } from "@/lib/hooks/use-modifier-key";
import { QuickActionsMenu } from "@/components/shell/QuickActionsMenu";

/**
 * Stable home for panel toggles and Setup at every desktop width.
 */
export function TopBarMoreMenu() {
  const label = useShortcutLabel();
  return (
    <QuickActionsMenu
      label="More tools"
      triggerLabel="Tools"
      className="hub-more-menu"
      actions={[
        {
          id: "notes",
          label: "Notes",
          icon: <FolderOpen size={14} />,
          event: "devhub:notes-toggle",
          shortcut: label("O", true),
        },
        {
          id: "tasks",
          label: "Today's tasks",
          icon: <ListTodo size={14} />,
          event: "devhub:tasks-toggle",
          shortcut: label("T", true),
        },
        {
          id: "diagrams",
          label: "Diagrams",
          icon: <PenTool size={14} />,
          event: "devhub:diagrams-toggle",
          shortcut: label("D", true),
        },
        { id: "setup", label: "Setup & integrations", icon: <Settings size={14} />, href: "/setup" },
      ]}
    />
  );
}
