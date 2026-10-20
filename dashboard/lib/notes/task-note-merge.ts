import { joinTaskNote, splitTaskNote } from "@shared/task-note/sections.ts";
import type { DevHubPartialBlock } from "@/lib/blocknote/schema";
import { prepareTaskNoteBlocks } from "@/lib/notes/prepare-task-note";

export interface MergedTaskNote {
  blocks: DevHubPartialBlock[];
}

/**
 * John edits a task note's free-form blocks while agents rewrite its standard sections.
 * `stored` is the note as it is on disk now (a vault file read), `outgoing` the whole
 * note an editor wants to save from an older version: return the stored header and
 * sections around the outgoing free-form blocks. Null when `stored` has no usable content.
 */
export function mergeAgentEditsIntoTask(
  stored: { content?: unknown },
  outgoing: unknown[],
): MergedTaskNote | null {
  if (!Array.isArray(stored.content)) return null;
  const blocks = joinTaskNote({
    ...splitTaskNote(prepareTaskNoteBlocks(stored.content) as unknown[]),
    freeform: splitTaskNote(outgoing).freeform,
  }) as DevHubPartialBlock[];
  return { blocks };
}
