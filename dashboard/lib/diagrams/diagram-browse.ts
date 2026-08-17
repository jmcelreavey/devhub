import {
  stripJsonExtension,
  toDiagramRoutePath,
  type DiagramTreeEntry,
} from "@/lib/diagram-utils";

/**
 * Client-safe diagram browse helpers — no `node:fs`.
 * Server FS indexing lives in `diagram-index.ts`.
 */

export interface DiagramSummary {
  /** Storage path without extension, e.g. `diagrams/Area/Topic/foo`. */
  path: string;
  name: string;
  href: string;
  /** Top-level folder id, or "" for root-level diagrams. */
  area: string;
  modified: number;
}

export interface DiagramAreaGroup {
  id: string;
  label: string;
  diagrams: DiagramSummary[];
  /** Nested folder count under this area (direct children that are dirs). */
  folderCount: number;
}

export interface DiagramIndex {
  diagrams: DiagramSummary[];
  areas: DiagramAreaGroup[];
  total: number;
}

export const DIAGRAM_ROOT_AREA_ID = "__root__";

/** Group summaries into area cards. FS / tree walks stay with the caller. */
export function groupDiagramsByArea(
  diagrams: DiagramSummary[],
  areaMetas: Array<{ id: string; folderCount: number }>,
): DiagramAreaGroup[] {
  const byArea = new Map<string, DiagramSummary[]>();
  for (const d of diagrams) {
    const key = d.area || DIAGRAM_ROOT_AREA_ID;
    const list = byArea.get(key) ?? [];
    list.push(d);
    byArea.set(key, list);
  }

  const byModified = (list: DiagramSummary[]) =>
    list.slice().sort((a, b) => b.modified - a.modified);

  const areas: DiagramAreaGroup[] = areaMetas.map((meta) => ({
    id: meta.id,
    label: meta.id,
    diagrams: byModified(byArea.get(meta.id) ?? []),
    folderCount: meta.folderCount,
  }));

  const rootDiagrams = byArea.get(DIAGRAM_ROOT_AREA_ID);
  if (rootDiagrams && rootDiagrams.length > 0) {
    areas.push({
      id: DIAGRAM_ROOT_AREA_ID,
      label: "Top level",
      diagrams: byModified(rootDiagrams),
      folderCount: 0,
    });
  }
  return areas;
}

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
