import { ContentConflictError, type ContentStorage } from "../../shared/storage/content.ts";
import { jsonVaultCodec } from "../../shared/vault/index.ts";

export function noteFilePath(path: string): string {
  return path.endsWith(".json") ? path : `${path}.json`;
}

export function docFilePath(path: string): string {
  return path.endsWith(".md") ? path : `${path}.md`;
}

export async function readNote(storage: ContentStorage, path: string) {
  const file = await storage.read(noteFilePath(path));
  return file ? { ...file, content: jsonVaultCodec.parse(file.content.toString("utf8")) } : null;
}

export async function writeNote(storage: ContentStorage, path: string, content: unknown, revision: string | null) {
  return storage.write(noteFilePath(path), jsonVaultCodec.serialize(content), revision);
}

export async function appendNote(storage: ContentStorage, path: string, blocks: unknown[]) {
  for (let attempt = 0; ; attempt++) {
    const existing = await readNote(storage, path);
    const combined = existing ? [...(Array.isArray(existing.content) ? existing.content : [existing.content]), ...blocks] : blocks;
    try {
      const file = await writeNote(storage, path, combined, existing?.revision ?? null);
      return { file, existed: Boolean(existing) };
    } catch (error) {
      if (!(error instanceof ContentConflictError) || attempt >= 1) throw error;
    }
  }
}
