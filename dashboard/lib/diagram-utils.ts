export const DIAGRAMS_DIR = "diagrams";

export interface TldrawDiagramData {
  type: "tldraw";
  version: 1;
  store: Record<string, unknown>;
}

export function createEmptyDiagram(): TldrawDiagramData {
  return {
    type: "tldraw",
    version: 1,
    store: {},
  };
}

export function isDiagramStoragePath(path: string): boolean {
  return path.startsWith(`${DIAGRAMS_DIR}/`);
}

export function stripJsonExtension(path: string): string {
  return path.replace(/\.json$/, "");
}

export function stripDiagramsPrefix(path: string): string {
  const cleanPath = stripJsonExtension(path);
  return cleanPath.startsWith(`${DIAGRAMS_DIR}/`)
    ? cleanPath.slice(DIAGRAMS_DIR.length + 1)
    : cleanPath;
}

export function toDiagramStoragePath(routePath: string): string {
  const cleanPath = stripJsonExtension(routePath).replace(/^\/+/, "");
  if (!cleanPath) return DIAGRAMS_DIR;
  return isDiagramStoragePath(cleanPath) ? cleanPath : `${DIAGRAMS_DIR}/${cleanPath}`;
}

export function toDiagramRoutePath(storagePath: string): string {
  return `/diagrams/${stripDiagramsPrefix(storagePath)}`;
}

export function toNotesApiPath(storagePath: string): string {
  return storagePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** Minimal tree-entry shape shared with /api/tree responses. */
export interface DiagramTreeEntry {
  type: "dir" | "file";
  name: string;
  path: string;
  children?: DiagramTreeEntry[];
  modified?: number;
}

export interface DiagramFolder {
  /** Folder path relative to the diagrams root, e.g. "Acme/Reports". */
  relPath: string;
  name: string;
  /** Full storage path, e.g. "diagrams/Acme/Reports". */
  storagePath: string;
}

export interface DiagramFile {
  /** Storage path without extension, e.g. "diagrams/Acme/foo". */
  path: string;
  name: string;
  modified?: number;
}

/** Normalise a folder path relative to the diagrams root (no leading/trailing slashes). */
export function normalizeDiagramFolder(relFolder: string | null | undefined): string {
  return (relFolder ?? "").replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
}

/** Storage path for a folder relative to the diagrams root. */
export function diagramFolderStoragePath(relFolder: string): string {
  const rel = normalizeDiagramFolder(relFolder);
  return rel ? `${DIAGRAMS_DIR}/${rel}` : DIAGRAMS_DIR;
}

/** Route href for browsing a diagrams folder. */
export function diagramFolderHref(relFolder: string): string {
  const rel = normalizeDiagramFolder(relFolder);
  return rel ? `/diagrams?folder=${encodeURIComponent(rel)}` : "/diagrams";
}

/** Parent folder of a rel folder path ("" for top level). */
export function diagramParentFolder(relFolder: string): string {
  const rel = normalizeDiagramFolder(relFolder);
  const idx = rel.lastIndexOf("/");
  return idx === -1 ? "" : rel.slice(0, idx);
}

/** Pull the top-level `diagrams/` subtree out of the full notes tree. */
export function extractDiagramsTree(tree: DiagramTreeEntry[]): DiagramTreeEntry[] {
  const root = tree.find((e) => e.type === "dir" && e.name === DIAGRAMS_DIR);
  return root?.children ?? [];
}

/** Navigate the diagrams subtree to a folder; null when the folder is missing. */
export function diagramFolderChildren(
  diagramsTree: DiagramTreeEntry[],
  relFolder: string,
): DiagramTreeEntry[] | null {
  const rel = normalizeDiagramFolder(relFolder);
  if (!rel) return diagramsTree;

  let entries = diagramsTree;
  for (const segment of rel.split("/")) {
    const next = entries.find((e) => e.type === "dir" && e.name === segment);
    if (!next) return null;
    entries = next.children ?? [];
  }
  return entries;
}

/** Split a folder's direct children into folders and diagram files. */
export function splitDiagramEntries(entries: DiagramTreeEntry[]): {
  folders: DiagramFolder[];
  files: DiagramFile[];
} {
  const folders: DiagramFolder[] = [];
  const files: DiagramFile[] = [];

  for (const entry of entries) {
    const storagePath = entry.path.replace(/\\/g, "/");
    if (entry.type === "dir") {
      folders.push({
        relPath: stripDiagramsPrefix(storagePath),
        name: entry.name,
        storagePath,
      });
    } else if (entry.name.endsWith(".json")) {
      files.push({
        path: stripJsonExtension(storagePath),
        name: stripJsonExtension(entry.name),
        modified: entry.modified,
      });
    }
  }

  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { folders, files };
}

/** Breadcrumb trail from the diagrams root down to the current folder. */
export function diagramBreadcrumbs(
  relFolder: string,
): Array<{ name: string; relPath: string }> {
  const rel = normalizeDiagramFolder(relFolder);
  const crumbs: Array<{ name: string; relPath: string }> = [
    { name: "Diagrams", relPath: "" },
  ];
  if (!rel) return crumbs;

  const segments = rel.split("/");
  let acc = "";
  for (const segment of segments) {
    acc = acc ? `${acc}/${segment}` : segment;
    crumbs.push({ name: segment, relPath: acc });
  }
  return crumbs;
}

/** All folder rel-paths in the diagrams tree (depth-first), excluding the root. */
export function collectDiagramFolderRelPaths(
  diagramsTree: DiagramTreeEntry[],
): string[] {
  const out: string[] = [];
  const walk = (entries: DiagramTreeEntry[]) => {
    for (const entry of entries) {
      if (entry.type !== "dir") continue;
      out.push(stripDiagramsPrefix(entry.path.replace(/\\/g, "/")));
      if (entry.children) walk(entry.children);
    }
  };
  walk(diagramsTree);
  return out.sort((a, b) => a.localeCompare(b));
}

export function createUniqueDiagramStoragePath(date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  const time = date.toTimeString().slice(0, 8).replace(/:/g, "");
  return `${DIAGRAMS_DIR}/${day}-${time}-diagram`;
}

/** Check if a tldraw diagram has any visible shapes for thumbnail purposes. */
export function hasVisibleDiagramShapes(store: Record<string, unknown>): boolean {
  const storeObj = store as { store?: Record<string, unknown> };
  const innerStore = storeObj.store ?? store;
  for (const key of Object.keys(innerStore)) {
    if (key.startsWith("shape:") && innerStore[key] && typeof innerStore[key] === "object") {
      return true;
    }
  }
  return false;
}
