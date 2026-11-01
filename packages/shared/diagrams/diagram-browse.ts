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

