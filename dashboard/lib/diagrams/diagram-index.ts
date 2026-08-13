import fs from "node:fs";
import path from "node:path";
import { getNotesDir } from "@/lib/content/dirs";
import { DIAGRAMS_DIR, stripJsonExtension, toDiagramRoutePath } from "@/lib/diagram-utils";
import {
  DIAGRAM_ROOT_AREA_ID,
  type DiagramAreaGroup,
  type DiagramIndex,
  type DiagramSummary,
} from "@/lib/diagrams/diagram-browse";

/**
 * Server FS index over `notes/diagrams/`.
 * Client browse helpers live in `diagram-browse.ts`.
 */

export type { DiagramAreaGroup, DiagramIndex, DiagramSummary };
export { DIAGRAM_ROOT_AREA_ID };

function walkDiagramFiles(absRoot: string, rel = ""): Array<{ rel: string; mtime: number }> {
  const abs = path.join(absRoot, rel);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Array<{ rel: string; mtime: number }> = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...walkDiagramFiles(absRoot, childRel));
    } else if (entry.name.endsWith(".json")) {
      try {
        const mtime = fs.statSync(path.join(absRoot, childRel)).mtimeMs;
        out.push({ rel: childRel, mtime });
      } catch {
        /* skip unreadable */
      }
    }
  }
  return out;
}

function countDirectFolders(absRoot: string, rel: string): number {
  const abs = path.join(absRoot, rel);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return 0;
  }
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).length;
}

function toSummary(relUnderDiagrams: string, modified: number): DiagramSummary {
  const storagePath = stripJsonExtension(`${DIAGRAMS_DIR}/${relUnderDiagrams}`);
  const name = storagePath.split("/").pop() ?? storagePath;
  const area = relUnderDiagrams.includes("/")
    ? relUnderDiagrams.slice(0, relUnderDiagrams.indexOf("/"))
    : "";
  return {
    path: storagePath,
    name,
    href: toDiagramRoutePath(storagePath),
    area,
    modified,
  };
}

export function getDiagramIndex(): DiagramIndex {
  const absRoot = path.join(getNotesDir(), DIAGRAMS_DIR);
  const files = walkDiagramFiles(absRoot);
  const diagrams = files
    .map(({ rel, mtime }) => toSummary(rel, mtime))
    .sort((a, b) => a.path.localeCompare(b.path));

  const byArea = new Map<string, DiagramSummary[]>();
  for (const d of diagrams) {
    const key = d.area || DIAGRAM_ROOT_AREA_ID;
    const list = byArea.get(key) ?? [];
    list.push(d);
    byArea.set(key, list);
  }

  let areaIds: string[] = [];
  try {
    areaIds = fs
      .readdirSync(absRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    areaIds = [...byArea.keys()].filter((id) => id !== DIAGRAM_ROOT_AREA_ID).sort();
  }

  const areas: DiagramAreaGroup[] = areaIds.map((id) => {
    const list = (byArea.get(id) ?? []).slice().sort((a, b) => b.modified - a.modified);
    return {
      id,
      label: id,
      diagrams: list,
      folderCount: countDirectFolders(absRoot, id),
    };
  });

  const rootDiagrams = byArea.get(DIAGRAM_ROOT_AREA_ID);
  if (rootDiagrams && rootDiagrams.length > 0) {
    areas.push({
      id: DIAGRAM_ROOT_AREA_ID,
      label: "Top level",
      diagrams: rootDiagrams.slice().sort((a, b) => b.modified - a.modified),
      folderCount: 0,
    });
  }

  return { diagrams, areas, total: diagrams.length };
}

export function getRecentDiagrams(limit = 6): DiagramSummary[] {
  return getDiagramIndex()
    .diagrams.slice()
    .sort((a, b) => b.modified - a.modified)
    .slice(0, limit);
}
