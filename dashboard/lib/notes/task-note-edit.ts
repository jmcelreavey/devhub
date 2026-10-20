import { applyTaskNoteOp, joinTaskNote, splitTaskNote, type NoteBlock, type TaskNoteOp } from "@shared/task-note/sections.ts";
import type { DevHubPartialBlock } from "@/lib/blocknote/schema";

type Blocks = DevHubPartialBlock[];

/**
 * The visual task note's editor only holds the free-form blocks. Put the rest of the note
 * (header, standard sections) from `whole` back around the editor's blocks, ready to save.
 */
export function foldEditorChange(whole: Blocks, editorChange: Blocks): Blocks {
  return joinTaskNote({
    ...splitTaskNote(whole as unknown[]),
    freeform: editorChange as NoteBlock[],
  }) as Blocks;
}

/** Apply a section action to the whole note. Null when it changed nothing; throws `TaskNoteOpError` when it cannot apply. */
export function applyTaskOpToBlocks(whole: Blocks, op: TaskNoteOp): Blocks | null {
  const result = applyTaskNoteOp(whole as unknown[], op);
  return result.changed ? (result.blocks as Blocks) : null;
}

export function sameFreeform(a: Blocks, b: Blocks): boolean {
  return JSON.stringify(splitTaskNote(a as unknown[]).freeform) === JSON.stringify(splitTaskNote(b as unknown[]).freeform);
}
