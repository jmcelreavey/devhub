import { describe, it, expect } from "vitest";
import {
  countDriftedLinkedEntriesInBlocks,
  patchLinkedEntryLabelsInBlocks,
  syncEntryLabel,
} from "./entry-label-sync";
import type { NoteContentBlock } from "./note-blocks";
import type { MasterListItem } from "./types";

const masterItem: MasterListItem = {
  id: "item-1",
  name: "Replacement fence slats",
  checked: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const blocks: NoteContentBlock[] = [
  {
    type: "sharedChecklist",
    props: {
      masterListId: "master-1",
      entriesJson: JSON.stringify([
        { id: "e1", label: "Replacement pickets (24)", masterItemId: "item-1" },
        { id: "e2", label: "Hammer", masterItemId: "other" },
      ]),
    },
    children: [],
  },
];

describe("entry-label-sync", () => {
  it("syncs a single entry label in memory", () => {
    const entries = [{ id: "e1", label: "Old", masterItemId: "item-1" }];
    expect(syncEntryLabel(entries, "e1", "New")[0].label).toBe("New");
  });

  it("counts drifted linked entries in note blocks", () => {
    expect(countDriftedLinkedEntriesInBlocks(blocks, "master-1", "item-1", masterItem)).toBe(1);
  });

  it("patches linked entry labels in note blocks", () => {
    const { blocks: next, entriesUpdated } = patchLinkedEntryLabelsInBlocks(
      blocks,
      "master-1",
      "item-1",
      masterItem.name,
    );
    expect(entriesUpdated).toBe(1);
    const json = String(next[0].props?.entriesJson);
    expect(json).toContain("Replacement fence slats");
    expect(json).not.toContain("Replacement pickets");
  });
});
