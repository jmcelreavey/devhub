import type { UserNoteItem } from "@shared/task-note/sections.ts";

export interface NoteCapability {
  running: boolean;
  liveFollowup: boolean;
  auto: boolean;
  confirmNeeded: boolean;
  runId?: string;
}

export interface AddUserNoteInput {
  taskId: string;
  text: string;
  updateAgent?: boolean;
  noteId?: string;
  confirmStop?: boolean;
}

export interface AddUserNoteResult {
  saved: true;
  note: UserNoteItem;
  capability: NoteCapability;
  agent: { mode: "followup" | "restarted" | "auto-continued" | "none"; runId?: string; error?: string };
}

export interface AddUserNoteDeps {
  capability(taskId: string): Promise<NoteCapability>;
  save(input: AddUserNoteInput): Promise<UserNoteItem>;
  followup(taskId: string, runId: string, guidance: string, noteId: string): Promise<void>;
  stop(taskId: string): Promise<void>;
  resume(taskId: string, guidance: string): Promise<string>;
  continueAuto(taskId: string, guidance: string): Promise<string | undefined>;
}

export function noteUpdateMode(state: NoteCapability): AddUserNoteResult["agent"]["mode"] {
  if (!state.running) return "none";
  if (state.liveFollowup && state.runId) return "followup";
  return state.auto ? "auto-continued" : "restarted";
}

export async function addUserNote(input: AddUserNoteInput, deps: AddUserNoteDeps): Promise<AddUserNoteResult> {
  const note = await deps.save(input);
  const result: AddUserNoteResult = { saved: true, note, capability: { running: false, liveFollowup: false, auto: false, confirmNeeded: false }, agent: { mode: "none" } };
  try {
    const capability = await deps.capability(input.taskId);
    result.capability = capability;
    if (!input.updateAgent) return result;
    const mode = noteUpdateMode(capability);
    if (mode === "none") return result;
    if (mode !== "followup" && capability.confirmNeeded && !input.confirmStop) {
      result.agent.error = "Note saved. Stopping would discard uncommitted work; confirm before updating the agent.";
      return result;
    }
    const guidance = "Note from John (the task owner) — treat as instructions from the user:\n" + note.text;
    if (mode === "followup") {
      await deps.followup(input.taskId, capability.runId!, guidance, note.id);
      result.agent = { mode, runId: capability.runId };
    } else {
      await deps.stop(input.taskId);
      const runId = mode === "auto-continued" ? await deps.continueAuto(input.taskId, guidance) : await deps.resume(input.taskId, guidance);
      result.agent = { mode, ...(runId ? { runId } : {}) };
    }
  } catch (error) {
    const message = input.updateAgent ? "Note saved, but the agent wasn't updated: " : "Note saved, but couldn't check the running agent: ";
    result.agent.error = message + (error instanceof Error ? error.message : "Unknown error");
  }
  return result;
}
