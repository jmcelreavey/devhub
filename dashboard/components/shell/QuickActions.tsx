"use client";

import { NotesBrowseButton } from "@/components/notes/NotesBrowseButton";
import { TasksBrowseButton } from "@/components/tasks/TasksBrowseButton";
import { DiagramsBrowseButton } from "@/components/diagrams/DiagramsBrowseButton";
import { TerminalDockButton } from "@/components/shell/TerminalDock";
import { TopBarMoreMenu } from "@/components/shell/TopBarMoreMenu";

/**
 * Notes, tasks and diagrams are one family: side panels. They sit inline when
 * the bar has room and fold into a Panels button when it does not. Terminal
 * stays visible either way — its badge is status. The container query in
 * globals.css (`.hub-panel-actions` / `.hub-panels-menu`) shows exactly one of
 * the inline row or the menu.
 */
export function QuickActions() {
  return (
    <>
      <span className="hub-panel-actions">
        <NotesBrowseButton />
        <TasksBrowseButton />
        <DiagramsBrowseButton />
      </span>
      <TopBarMoreMenu />
      <TerminalDockButton />
    </>
  );
}
