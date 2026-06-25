"use client";

import {
  diagramFolderStoragePath,
  diagramParentFolder,
  stripDiagramsPrefix,
  toNotesApiPath,
  DIAGRAMS_DIR,
} from "@/lib/diagram-utils";
import { broadcastNoteAutosaveInvalidation } from "@/lib/note-autosave-invalidation";

/**
 * Diagrams live inside the notes vault (under `diagrams/`), so folder
 * operations reuse the shared notes vault API. These thin wrappers keep the
 * page component declarative; pure path math lives in diagram-utils.
 */

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? fallback;
}

/** Create an empty folder inside `relFolder`. */
export async function createDiagramFolder(
  relFolder: string,
  name: string,
): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Folder name is required");
  const storagePath = `${diagramFolderStoragePath(relFolder)}/${trimmed}`;
  const res = await fetch(`/api/notes/${toNotesApiPath(storagePath)}?dir=1`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Could not create folder"));
  return stripDiagramsPrefix(storagePath);
}

/** Delete a folder (and everything inside it). */
export async function deleteDiagramFolder(storagePath: string): Promise<void> {
  const res = await fetch(`/api/notes/${toNotesApiPath(storagePath)}?dir=1`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Could not delete folder"));
}

/**
 * Rename a folder in place — shaped for `InlineNoteRename`'s `renameFile` prop:
 * `(currentSlug, newBaseName) => Promise<newSlug>`. `currentSlug` is the folder
 * storage path (e.g. "diagrams/Acme"); returns the new storage path.
 */
export async function renameDiagramFolder(
  currentStoragePath: string,
  newBaseName: string,
): Promise<string> {
  const trimmed = newBaseName.trim();
  if (!trimmed) throw new Error("Folder name is required");
  const parentRel = diagramParentFolder(stripDiagramsPrefix(currentStoragePath));
  const newPath = `${diagramFolderStoragePath(parentRel)}/${trimmed}`;
  if (newPath === currentStoragePath) throw new Error("unchanged");

  const res = await fetch(`/api/notes/${toNotesApiPath(currentStoragePath)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newPath, dir: true }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Could not rename folder"));
  return newPath;
}

/** Move a diagram or folder into `targetRelFolder`. Returns the new storage path. */
export async function moveDiagramEntry(
  sourceStoragePath: string,
  targetRelFolder: string,
  isDir: boolean,
): Promise<string> {
  const name = sourceStoragePath.split("/").pop() ?? sourceStoragePath;
  const newPath = `${diagramFolderStoragePath(targetRelFolder)}/${name}`;
  if (newPath === sourceStoragePath) throw new Error("unchanged");
  // Guard against dropping a folder inside itself.
  if (isDir && (newPath === sourceStoragePath || newPath.startsWith(`${sourceStoragePath}/`))) {
    throw new Error("Can't move a folder into itself");
  }
  broadcastNoteAutosaveInvalidation(sourceStoragePath);

  const res = await fetch(`/api/notes/${toNotesApiPath(sourceStoragePath)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newPath, dir: isDir }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Could not move item"));
  return newPath;
}

export { DIAGRAMS_DIR };
