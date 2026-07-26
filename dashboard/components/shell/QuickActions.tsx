"use client";

import { NotesBrowseButton } from "@/components/notes/NotesBrowseButton";
import { TasksBrowseButton } from "@/components/tasks/TasksBrowseButton";
import { DiagramsBrowseButton } from "@/components/diagrams/DiagramsBrowseButton";
import { TerminalDockButton } from "@/components/shell/TerminalDock";

/**
 * Shared quick-action cluster — Notes / Tasks / Diagrams panels plus the
 * terminal drawer toggle. Single source of truth so the desktop top bar and
 * the mobile top bar stay in sync (previously the trio was duplicated and the
 * terminal toggle only existed on desktop, leaving no way to open it on
 * mobile).
 */
export function QuickActions() {
  return (
    <>
      <NotesBrowseButton />
      <TasksBrowseButton />
      <DiagramsBrowseButton />
      <TerminalDockButton />
    </>
  );
}
