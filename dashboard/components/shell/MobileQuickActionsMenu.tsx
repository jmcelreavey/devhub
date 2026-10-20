"use client";

import { FolderOpen, ListTodo, PenTool, TerminalSquare } from "lucide-react";
import { QuickActionsMenu, type QuickMenuAction } from "@/components/shell/QuickActionsMenu";

/**
 * On a phone the top bar can't hold Notes + Tasks + Diagrams + Terminal as
 * separate icons without crowding, so they collapse into one overflow menu.
 */
const ACTIONS: QuickMenuAction[] = [
  { id: "notes", label: "Notes", section: "Panels", icon: <FolderOpen size={14} />, event: "devhub:notes-toggle" },
  { id: "tasks", label: "Tasks", section: "Panels", icon: <ListTodo size={14} />, event: "devhub:tasks-toggle" },
  { id: "diagrams", label: "Diagrams", section: "Panels", icon: <PenTool size={14} />, event: "devhub:diagrams-toggle" },
  { id: "terminal", label: "Terminal", section: "Workspace", icon: <TerminalSquare size={14} />, event: "devhub:terminal-toggle" },
];

export function MobileQuickActionsMenu() {
  return <QuickActionsMenu actions={ACTIONS} />;
}
