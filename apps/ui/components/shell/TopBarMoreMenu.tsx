"use client";

import { FolderOpen, ListTodo, PanelsTopLeft, PenTool } from "lucide-react";
import { useShortcutLabel } from "@/lib/hooks/use-modifier-key";
import { QuickActionsMenu } from "@/components/shell/QuickActionsMenu";

/**
 * The three workspace panels, folded into one button when the top bar runs
 * out of room. Setup is not here — it lives with appearance and profile.
 */
export function TopBarMoreMenu() {
  const label = useShortcutLabel();
  return (
    <QuickActionsMenu
      label="Panels"
      className="hub-panels-menu"
      icon={<PanelsTopLeft size={14} aria-hidden />}
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
      ]}
    />
  );
}
