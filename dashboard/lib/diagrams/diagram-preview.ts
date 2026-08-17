import { isDiagramStoragePath } from "@/lib/diagram-utils";
import { getVaultStorage } from "@/lib/vault/vault-registry";
import { previewFromDiagramContent, type DiagramPreview } from "@/lib/diagrams/thumbnail-cache";

export type { DiagramPreview };

interface Cached {
  modified: number;
  preview: DiagramPreview;
}

const cache = new Map<string, Cached>();

export function getDiagramPreview(storagePath: string): DiagramPreview | null {
  if (!isDiagramStoragePath(storagePath)) return null;
  const file = getVaultStorage("notes").read(storagePath);
  if (!file) return null;
  const hit = cache.get(storagePath);
  if (hit && hit.modified === file.modified) return hit.preview;
  const preview = previewFromDiagramContent(file.content);
  cache.set(storagePath, { modified: file.modified, preview });
  return preview;
}

export function getDiagramPreviews(paths: string[]): Record<string, DiagramPreview> {
  const out: Record<string, DiagramPreview> = {};
  for (const path of paths) {
    const preview = getDiagramPreview(path);
    if (preview) out[path] = preview;
  }
  return out;
}
