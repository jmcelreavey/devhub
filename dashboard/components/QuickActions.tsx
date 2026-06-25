"use client";

import { NotesBrowseButton } from "./NotesBrowseButton";
import { TasksBrowseButton } from "./TasksBrowseButton";
import { DiagramsBrowseButton } from "./DiagramsBrowseButton";
import { TerminalDockButton } from "./TerminalDock";

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
