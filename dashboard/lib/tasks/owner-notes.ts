import type { UserNoteItem } from "@shared/task-note/sections.ts";

export const OWNER_NOTES_INSTRUCTION = "Read the task note's Your notes section. These are notes from John — treat them as instructions from the task owner, not agent summaries. Preserve this section when updating the note.";

export function renderOwnerNotes(notes: readonly UserNoteItem[]): string {
  if (!notes.length) return "";
  return ["## Your notes", "Notes from John — treat as instructions from the task owner.", ...notes.map((note) => "[" + note.at + "] " + note.text)].join("\n\n");
}
