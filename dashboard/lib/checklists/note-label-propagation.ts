import type { NotesStorage } from "@/lib/storage";
import type { TreeEntry } from "@/lib/storage";
import {
  countDriftedLinkedEntriesInBlocks,
  patchLinkedEntryLabelsInBlocks,
} from "./entry-label-sync";
import type { NoteContentBlock } from "./note-blocks";
import { getMasterList } from "./storage";
import { masterItemById } from "./resolution";

function collectNotePaths(entries: TreeEntry[], prefix = ""): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.type === "file" && entry.name.endsWith(".json")) {
      paths.push(rel.replace(/\.json$/, ""));
    }
    if (entry.type === "dir" && entry.children) {
      paths.push(...collectNotePaths(entry.children, rel));
    }
  }
  return paths;
}

export interface LabelPropagationResult {
  notesUpdated: number;
  entriesUpdated: number;
  notePaths: string[];
}

export interface LabelDriftSummary {
  driftedEntries: number;
  notePaths: string[];
}

export function countLinkedLabelDriftAcrossNotes(
  storage: NotesStorage,
  masterListId: string,
  masterItemId: string,
  excludeNotePath?: string,
): LabelDriftSummary {
  const master = getMasterList(masterListId);
  const item = masterItemById(master ?? undefined, masterItemId);
  if (!item) return { driftedEntries: 0, notePaths: [] };

  const notePaths: string[] = [];
  let driftedEntries = 0;

  for (const notePath of collectNotePaths(storage.list())) {
    if (excludeNotePath && notePath === excludeNotePath) continue;
    const note = storage.read(notePath);
    if (!note || !Array.isArray(note.content)) continue;
    const blocks = note.content as NoteContentBlock[];
    const count = countDriftedLinkedEntriesInBlocks(blocks, masterListId, masterItemId, item);
    if (count > 0) {
      driftedEntries += count;
      notePaths.push(notePath);
    }
  }

  return { driftedEntries, notePaths };
}

export async function propagateLinkedEntryLabelToNotes(
  storage: NotesStorage,
  masterListId: string,
  masterItemId: string,
  newLabel: string,
  excludeNotePath?: string,
): Promise<LabelPropagationResult> {
  const notePaths: string[] = [];
  let notesUpdated = 0;
  let entriesUpdated = 0;

  for (const notePath of collectNotePaths(storage.list())) {
    if (excludeNotePath && notePath === excludeNotePath) continue;
    const note = storage.read(notePath);
    if (!note || !Array.isArray(note.content)) continue;

    const blocks = note.content as NoteContentBlock[];
    const patched = patchLinkedEntryLabelsInBlocks(blocks, masterListId, masterItemId, newLabel);
    if (patched.entriesUpdated === 0) continue;

    storage.write(notePath, patched.blocks);
    notesUpdated += 1;
    entriesUpdated += patched.entriesUpdated;
    notePaths.push(notePath);
  }

  return { notesUpdated, entriesUpdated, notePaths };
}
