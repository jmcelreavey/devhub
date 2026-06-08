import { searchNotes, type SearchResult as SharedSearchResult } from "@/lib/notes-search";
import { readNoteAssetBytes, writeNoteAssetBytes } from "@/lib/notes-assets";
import type { VaultCodec } from "@/lib/vault/vault-codec";
import {
  VaultStorage as BaseVaultStorage,
  searchTextFiles,
  type TextSearchResult,
  type TreeEntry,
  type VaultFileResult,
} from "../../../shared/vault/vault-storage.ts";

export type { TreeEntry, VaultFileResult, TextSearchResult };
export { searchTextFiles };

export type SearchResult = SharedSearchResult;

export class VaultStorage extends BaseVaultStorage {
  writeAsset(relPath: string, data: Buffer): { path: string; size: number; modified: number } {
    return writeNoteAssetBytes(this.root, relPath, data);
  }

  readAsset(relPath: string): Buffer | null {
    return readNoteAssetBytes(this.root, relPath);
  }

  search(query: string, options?: { includeTldraw?: boolean }): SearchResult[] | TextSearchResult[] {
    if (this.codec.extension !== ".json") {
      return this.searchText(query);
    }
    return searchNotes(this.root, query, {
      includeTldraw: options?.includeTldraw ?? true,
    });
  }
}

export type { VaultCodec };
