import { searchNotes, type SearchResult as SharedSearchResult } from "../../../shared/notes-search/search.ts";
import { isWorkspaceNoteRel } from "../../../shared/notes-search/scope.ts";
import {
  readNoteAssetBytes,
  writeNoteAssetBytes,
} from "../../../shared/notes-assets/index.ts";
import {
  VaultStorage,
  jsonVaultCodec,
  type TreeEntry,
} from "../../../shared/vault/index.ts";

export { isWorkspaceNoteRel };
export type { TreeEntry };

export type NoteResult = {
  path: string;
  content: unknown;
  modified: number;
  size: number;
};

export type SearchResult = SharedSearchResult;

/** Notes vault for MCP — workspace-scoped search and asset helpers on shared storage. */
export class NotesStorage extends VaultStorage {
  constructor(rootDir: string) {
    super(rootDir, jsonVaultCodec);
  }

  writeAsset(relPath: string, data: Buffer): { path: string; size: number; modified: number } {
    return writeNoteAssetBytes(this.root, relPath, data);
  }

  readAsset(relPath: string): Buffer | null {
    return readNoteAssetBytes(this.root, relPath);
  }

  /** Workspace search (daily + root scratch). See shared/notes-search/README.md. */
  search(query: string): SearchResult[] {
    return searchNotes(this.root, query, {
      includePath: isWorkspaceNoteRel,
      includeTldraw: false,
    });
  }

  getAllNoteFiles(): string[] {
    return this.getAllVaultFiles();
  }
}
