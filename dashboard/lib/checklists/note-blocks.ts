import type { MasterList, SharedChecklistEntry } from "./types";
import { getMasterForNotePath } from "./paths";

export interface NoteContentBlock {
  type: string;
  props?: Record<string, unknown>;
  children?: NoteContentBlock[];
}

export function parseSharedChecklistEntries(entriesJson: string): SharedChecklistEntry[] {
  try {
    const parsed = JSON.parse(entriesJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is SharedChecklistEntry =>
        !!row &&
        typeof row === "object" &&
        typeof (row as SharedChecklistEntry).id === "string" &&
        typeof (row as SharedChecklistEntry).label === "string",
    );
  } catch {
    return [];
  }
}

export function stringifySharedChecklistEntries(entries: SharedChecklistEntry[]): string {
  return JSON.stringify(entries);
}

export function noteBlocksHaveLegacyCollection(blocks: NoteContentBlock[]): boolean {
  return blocks.some((block) => block.type === "collection");
}

/** Migrate legacy `collection` blocks to `sharedChecklist` on note load. */
export function migrateNoteBlocks(
  blocks: NoteContentBlock[],
  notePath: string,
  masters: MasterList[],
): NoteContentBlock[] {
  if (!noteBlocksHaveLegacyCollection(blocks)) return blocks;

  const folderMaster = getMasterForNotePath(notePath, masters);

  return blocks.map((block) => {
    if (block.type !== "collection") return block;
    const props = block.props as { collectionId?: string } | undefined;
    const legacyId = typeof props?.collectionId === "string" ? props.collectionId : "";
    const masterListId = folderMaster?.id ?? legacyId;
    return {
      type: "sharedChecklist",
      props: {
        masterListId,
        entriesJson: "[]",
      },
      children: block.children ?? [],
    };
  });
}
