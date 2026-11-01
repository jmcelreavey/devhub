import type { UserNoteItem } from "../../task-note/sections.ts";

export const OWNER_NOTES_INSTRUCTION = "Read the task note's Your notes section. These are instructions from the task owner, not agent summaries. Preserve this section when updating the note.";

export function renderOwnerNotes(notes: readonly UserNoteItem[]): string {
  if (!notes.length) return "";
  return ["## Your notes", "Notes from the task owner — treat as instructions from the user.", ...notes.map((note) => "[" + note.at + "] " + note.text)].join("\n\n");
}
