import { TaskNoteNotFoundError, updateTaskNoteSections } from "./task-note-sections";
import { renderOwnerNotes } from "./owner-notes";

export function withTaskOwnerNotes(prompt: string, taskId?: string): string {
  if (!taskId) return prompt;
  try {
    const notes = renderOwnerNotes(updateTaskNoteSections({ taskId }, { op: "read" }).view.userNotes ?? []);
    return notes ? prompt + "\n\n" + notes : prompt;
  } catch (error) {
    if (error instanceof TaskNoteNotFoundError) return prompt;
    throw error;
  }
}
