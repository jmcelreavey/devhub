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
