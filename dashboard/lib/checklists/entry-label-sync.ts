import type { NoteContentBlock } from "./note-blocks";
import { parseSharedChecklistEntries, stringifySharedChecklistEntries } from "./note-blocks";
import { entryLabelDrift, masterItemById } from "./resolution";
import type { MasterList, MasterListItem, SharedChecklistEntry } from "./types";

export function syncEntryLabel(
  entries: SharedChecklistEntry[],
  entryId: string,
  label: string,
): SharedChecklistEntry[] {
  return entries.map((row) => (row.id === entryId ? { ...row, label } : row));
}

export function detachEntry(entries: SharedChecklistEntry[], entryId: string): SharedChecklistEntry[] {
  return entries.map((row) =>
    row.id === entryId
      ? { ...row, masterItemId: undefined, standaloneChecked: row.standaloneChecked ?? false }
      : row,
  );
}

function walkNoteBlocks(
  blocks: NoteContentBlock[],
  visit: (block: NoteContentBlock) => void,
): void {
  for (const block of blocks) {
    visit(block);
    if (block.children?.length) walkNoteBlocks(block.children, visit);
  }
}

export function countDriftedLinkedEntriesInBlocks(
  blocks: NoteContentBlock[],
  masterListId: string,
  masterItemId: string,
  masterItem: MasterListItem,
): number {
  const master: MasterList = {
    schemaVersion: 2,
    id: masterListId,
    name: "",
    scopePath: "",
    items: [masterItem],
    createdAt: "",
    updatedAt: "",
  };
  let count = 0;
  walkNoteBlocks(blocks, (block) => {
    if (block.type !== "sharedChecklist") return;
    const props = block.props ?? {};
    if (props.masterListId !== masterListId) return;
    const entries = parseSharedChecklistEntries(String(props.entriesJson ?? "[]"));
    for (const entry of entries) {
      if (entry.masterItemId !== masterItemId) continue;
      if (entryLabelDrift(entry, master)) count += 1;
    }
  });
  return count;
}

export function patchLinkedEntryLabelsInBlocks(
  blocks: NoteContentBlock[],
  masterListId: string,
  masterItemId: string,
  newLabel: string,
): { blocks: NoteContentBlock[]; entriesUpdated: number } {
  let entriesUpdated = 0;

  const mapBlocks = (nodes: NoteContentBlock[]): NoteContentBlock[] =>
    nodes.map((block) => {
      const children = block.children?.length ? mapBlocks(block.children) : block.children;

      if (block.type !== "sharedChecklist") {
        return children === block.children ? block : { ...block, children };
      }

      const props = block.props ?? {};
      if (props.masterListId !== masterListId) {
        return children === block.children ? block : { ...block, children };
      }

      const entries = parseSharedChecklistEntries(String(props.entriesJson ?? "[]"));
      let changed = false;
      const nextEntries = entries.map((entry) => {
        if (entry.masterItemId !== masterItemId || entry.label === newLabel) return entry;
        changed = true;
        entriesUpdated += 1;
        return { ...entry, label: newLabel };
      });

      if (!changed) {
        return children === block.children ? block : { ...block, children };
      }

      return {
        ...block,
        children,
        props: {
          ...props,
          entriesJson: stringifySharedChecklistEntries(nextEntries),
        },
      };
    });

  return { blocks: mapBlocks(blocks), entriesUpdated };
}

export function masterItemLabel(master: MasterList | undefined, masterItemId: string): string | undefined {
  return masterItemById(master, masterItemId)?.name;
}
