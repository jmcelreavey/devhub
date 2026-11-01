import {
  stripJsonExtension,
  toDiagramRoutePath,
  type DiagramTreeEntry,
} from "../../../../packages/shared/ui-lib/diagrams/utils";

/**
 * Client-safe diagram browse helpers — no `node:fs`.
 * Server FS indexing lives in `diagram-index.ts`.
 */

import { groupDiagramsByArea, type DiagramAreaGroup, type DiagramSummary } from "@shared/diagrams/diagram-browse";
export { DIAGRAM_ROOT_AREA_ID, groupDiagramsByArea } from "@shared/diagrams/diagram-browse";
export type { DiagramSummary, DiagramAreaGroup, DiagramIndex } from "@shared/diagrams/diagram-browse";

/** Derive the same area/recent shape from a client `/api/tree` diagrams subtree. */
export function diagramBrowseModelFromTree(diagramsTree: DiagramTreeEntry[]): {
  areas: DiagramAreaGroup[];
  recent: DiagramSummary[];
  total: number;
} {
  const diagrams: DiagramSummary[] = [];

  const walk = (entries: DiagramTreeEntry[], area: string) => {
    for (const entry of entries) {
      const storagePath = entry.path.replace(/\\/g, "/");
      if (entry.type === "dir") {
        const nextArea = area || entry.name;
        walk(entry.children ?? [], nextArea);
      } else if (entry.name.endsWith(".json")) {
        const clean = stripJsonExtension(storagePath);
        diagrams.push({
          path: clean,
          name: stripJsonExtension(entry.name),
          href: toDiagramRoutePath(clean),
          area,
          modified: entry.modified ?? 0,
        });
      }
    }
  };
  walk(diagramsTree, "");

  const topFolders = diagramsTree
    .filter((e) => e.type === "dir")
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  const areas = groupDiagramsByArea(
    diagrams,
    topFolders.map((id) => {
      const folder = diagramsTree.find((e) => e.type === "dir" && e.name === id);
      return {
        id,
        folderCount: (folder?.children ?? []).filter((c) => c.type === "dir").length,
      };
    }),
  );

  const recent = diagrams.slice().sort((a, b) => b.modified - a.modified).slice(0, 6);
  return { areas, recent, total: diagrams.length };
}

/** sessionStorage key for last browsed folder (relative to diagrams root). */
export const DIAGRAMS_LAST_FOLDER_KEY = "devhub:diagrams-last-folder";

export function readLastDiagramFolder(): string {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(DIAGRAMS_LAST_FOLDER_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeLastDiagramFolder(relFolder: string): void {
  if (typeof window === "undefined") return;
  try {
    if (relFolder) sessionStorage.setItem(DIAGRAMS_LAST_FOLDER_KEY, relFolder);
    else sessionStorage.removeItem(DIAGRAMS_LAST_FOLDER_KEY);
  } catch {
    /* private mode */
  }
}
