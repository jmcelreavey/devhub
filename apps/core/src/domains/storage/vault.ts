import { createFileContentStorage } from "../../../../../packages/shared/storage/file-content.ts";
import { searchNotes, type SearchResult as SharedSearchResult } from "../../../../../packages/shared/notes-search/search.ts";
import { readNoteAssetBytes, assertNoteAssetRelPath } from "../../../../../packages/shared/notes-assets/server.ts";
import type { VaultCodec } from "../../../../../packages/shared/vault/vault-codec.ts";
import {
  VaultStorage as BaseVaultStorage,
  searchTextFiles,
  type TextSearchResult,
  type TreeEntry,
  type VaultFileResult,
} from "../../../../../packages/shared/vault/vault-storage.ts";

export type { TreeEntry, VaultFileResult, TextSearchResult };
export { searchTextFiles };

export type SearchResult = SharedSearchResult;

export class VaultStorage extends BaseVaultStorage {
  writeContent(filePath: string, content: unknown, expectedRevision: string | null): Promise<VaultFileResult> {
    return this.write(filePath, content, expectedRevision);
  }

  async writeAsset(relPath: string, data: Buffer) {
    const relative = assertNoteAssetRelPath(relPath);
    const storage = createFileContentStorage(this.root);
    const current = await storage.assets.read(relative);
    return storage.assets.write(relative, data, current?.revision ?? null);
  }

  readAsset(relPath: string): Buffer | null {
    return readNoteAssetBytes(this.root, relPath);
  }

  search(query: string, options?: { includeTldraw?: boolean }): SearchResult[] | TextSearchResult[] {
    if (this.codec.extension !== ".json") {
      return this.searchText(query);
    }
    return searchNotes(this.confined(this.root), query, {
      includeTldraw: options?.includeTldraw ?? true,
    });
  }
}

export type { VaultCodec };
