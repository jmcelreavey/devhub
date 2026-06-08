import type { TreeEntry } from "./storage";

/** Per-note image folder; hidden from the notes file sidebar (served via /api/notes-assets). */
export const NOTE_ASSET_DIR_NAME = "assets";

/**
 * Notes sidebar: show folders that contain notes and `.json` files only.
 * Hides `assets/` dirs and empty wrapper dirs (e.g. `fence-repair-repaint/` next to `fence-repair-repaint.json`).
 */
export function filterNotesSidebarTree(entries: TreeEntry[]): TreeEntry[] {
  const result: TreeEntry[] = [];

  for (const entry of entries) {
    if (entry.name === "diagrams") continue;

    if (entry.type === "file") {
      if (entry.name.endsWith(".json")) result.push(entry);
      continue;
    }

    if (entry.name === NOTE_ASSET_DIR_NAME) continue;

    const children = entry.children ? filterNotesSidebarTree(entry.children) : [];
    if (children.length === 0) continue;

    result.push({ ...entry, children });
  }

  return result;
}
