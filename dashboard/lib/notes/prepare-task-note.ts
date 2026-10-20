import { migrateLegacyTaskNote } from "@shared/task-note/sections.ts";
import type { DevHubPartialBlock } from "@/lib/blocknote/schema";
import { repairNoteBlocks } from "@/lib/notes/repair-blocks";

/**
 * Task notes as they should be held in memory: scaffold leftovers repaired, and an old
 * bullet-line header folded into the pill metadata. Nothing is written until the next save.
 * Used for the first load and for every version pulled in from disk, so a remote copy
 * compares equal to the local one when only the stored form differs.
 */
export function prepareTaskNoteBlocks(content: unknown[]): DevHubPartialBlock[] {
  return migrateLegacyTaskNote(repairNoteBlocks(content as object[]) as unknown[]).blocks as DevHubPartialBlock[];
}
