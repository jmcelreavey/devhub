import type { getAISlashMenuItems } from "@blocknote/xl-ai";

/** BlockNote AI helpers are typed against the default schema, not DevHub's custom blocks. */
export type BlockNoteAiEditor = Parameters<typeof getAISlashMenuItems>[0];

export function asBlockNoteAiEditor(editor: unknown): BlockNoteAiEditor {
  return editor as BlockNoteAiEditor;
}
