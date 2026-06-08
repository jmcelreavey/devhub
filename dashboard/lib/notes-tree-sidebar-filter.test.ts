import { describe, expect, it } from "vitest";
import { filterNotesSidebarTree } from "./notes-tree-sidebar-filter";
import type { TreeEntry } from "./storage";

describe("filterNotesSidebarTree", () => {
  it("hides assets dirs and note-scoped asset wrapper folders", () => {
    const raw: TreeEntry[] = [
      {
        type: "dir",
        name: "garden",
        path: "garden",
        children: [
          { type: "file", name: "fence-repair-repaint.json", path: "garden/fence-repair-repaint.json" },
          {
            type: "dir",
            name: "fence-repair-repaint",
            path: "garden/fence-repair-repaint",
            children: [
              {
                type: "dir",
                name: "assets",
                path: "garden/fence-repair-repaint/assets",
                children: [],
              },
            ],
          },
          { type: "file", name: "bed.json", path: "garden/bed.json" },
        ],
      },
    ];

    const filtered = filterNotesSidebarTree(raw);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe("garden");
    expect(filtered[0].children?.map((e) => e.name)).toEqual([
      "fence-repair-repaint.json",
      "bed.json",
    ]);
  });

  it("keeps folders that contain real notes", () => {
    const raw: TreeEntry[] = [
      {
        type: "dir",
        name: "daily",
        path: "daily",
        children: [
          { type: "file", name: "2026-05-23.json", path: "daily/2026-05-23.json" },
        ],
      },
    ];

    expect(filterNotesSidebarTree(raw)).toEqual(raw);
  });
});
